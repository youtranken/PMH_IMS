import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { FeatureHolderRegistry } from '../../common/feature-holders.registry';
import { FEATURE_TICKS, holdingConflicts, type FeatureHolding } from '../../common/features';
import { conflictOnUnique } from '../../common/sql';
import type { Tx } from '../../common/tx';
import { AuditWriterService } from '../audit/audit-writer.service';
import { FeatureGroupsService } from '../users/feature-groups.service';
import { UsersService } from '../users/users.service';
import type { FeatureGroup } from '../users/users.types';

interface Actor {
  id: string;
  email: string;
}

const NAME_TAKEN = { code: 'FEATURE_GROUP_NAME_TAKEN', message: 'Đã có nhóm quyền tên này.' };

/** Màn Nhóm quyền của SA (Q-31): tạo / sửa / xoá nhóm, gán Member vào nhóm. */
@Injectable()
export class FeatureGroupsAdminService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly groups: FeatureGroupsService,
    private readonly users: UsersService,
    private readonly holders: FeatureHolderRegistry,
    private readonly audit: AuditWriterService,
  ) {}

  list(): Promise<FeatureGroup[]> {
    return this.groups.list();
  }

  async create(actor: Actor, input: { name: string; features: string[] }): Promise<{ id: string }> {
    const name = cleanName(input.name);
    const features = cleanTicks(input.features);
    try {
      return await this.db.transaction(async (tx) => {
        const id = await this.groups.createWithin(tx, { name, features });
        await this.audit.appendWithin(tx, {
          actor: actor.email,
          action: 'feature_group.created',
          objectType: 'feature_group',
          objectId: id,
          detail: { name, features },
        });
        return { id };
      });
    } catch (error) {
      throw conflictOnUnique(error, NAME_TAKEN, 'feature_group_name_key');
    }
  }

  async update(actor: Actor, id: string, input: { name?: string; features?: string[] }): Promise<void> {
    const patch = {
      ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
      ...(input.features !== undefined ? { features: cleanTicks(input.features) } : {}),
    };
    try {
      await this.db.transaction(async (tx) => {
        const before = await this.requireLocked(tx, id);
        const ticks = patch.features;
        if (ticks) {
          const members = await this.groups.memberIdsWithin(tx, id);
          await this.assertNoHolderLoses(new Map(members.map((userId) => [userId, ticks])));
        }
        await this.groups.updateWithin(tx, id, patch);
        await this.audit.appendWithin(tx, {
          actor: actor.email,
          action: 'feature_group.updated',
          objectType: 'feature_group',
          objectId: id,
          detail: {
            before: { name: before.name, features: before.features },
            after: { name: patch.name ?? before.name, features: patch.features ?? before.features },
          },
        });
      });
    } catch (error) {
      throw conflictOnUnique(error, NAME_TAKEN, 'feature_group_name_key');
    }
  }

  async remove(actor: Actor, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const before = await this.requireLocked(tx, id);
      const members = await this.groups.memberIdsWithin(tx, id);
      if (members.length > 0) {
        throw new ConflictException({
          code: 'FEATURE_GROUP_IN_USE',
          message: `Nhóm "${before.name}" còn ${members.length} người. Chuyển họ sang nhóm khác trước.`,
        });
      }
      await this.groups.deleteWithin(tx, id);
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'feature_group.deleted',
        objectType: 'feature_group',
        objectId: id,
        detail: { name: before.name, features: before.features },
      });
    });
  }

  /** Gán Member vào nhóm; `null` = "Đủ quyền". */
  async assign(actor: Actor, userId: string, groupId: string | null): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException({ code: 'ACCOUNT_NOT_FOUND', message: 'Không tìm thấy tài khoản.' });
    if (user.featureGroupId === groupId) return;
    if (user.role !== 'member' && groupId !== null) {
      throw new BadRequestException({
        code: 'FEATURE_GROUP_MEMBER_ONLY',
        message: 'Chỉ gán nhóm quyền cho Thành viên. SA và Quản trị luôn đủ quyền.',
      });
    }
    await this.db.transaction(async (tx) => {
      await this.assignWithin(tx, userId, groupId);
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'account.feature_group.changed',
        objectType: 'user',
        objectId: userId,
        detail: { before: user.featureGroupId, after: groupId },
      });
    });
  }

  /** Dùng chung cho đổi nhóm và tạo tài khoản có nhóm: khóa nhóm rồi kiểm người giữ việc. */
  async assignWithin(tx: Tx, userId: string, groupId: string | null): Promise<void> {
    if (groupId !== null) {
      const group = await this.requireLocked(tx, groupId);
      await this.assertNoHolderLoses(new Map([[userId, group.features]]));
    }
    await this.users.setFeatureGroupWithin(tx, userId, groupId);
  }

  private async requireLocked(tx: Tx, id: string) {
    const group = await this.groups.lockWithin(tx, id);
    if (!group) {
      throw new NotFoundException({ code: 'FEATURE_GROUP_NOT_FOUND', message: 'Nhóm quyền không còn. Tải lại trang.' });
    }
    return group;
  }

  /** Q-31: không bỏ tick / chuyển nhóm làm người phụ trách mất phiếu mình phụ trách. */
  private async assertNoHolderLoses(ticksByUser: Map<string, readonly string[] | null>): Promise<void> {
    const conflicts = holdingConflicts(await this.holders.holdings([...ticksByUser.keys()]), ticksByUser);
    if (conflicts.length === 0) return;
    throw new ConflictException({ code: 'FEATURE_GROUP_HOLDER', message: await this.holderMessage(conflicts) });
  }

  private async holderMessage(conflicts: FeatureHolding[]): Promise<string> {
    const names = await this.users.namesByIds([...new Set(conflicts.map((c) => c.userId))]);
    const parts = conflicts.map((c) => `${names.get(c.userId) ?? c.userId} đang phụ trách ${c.label}`);
    return `${parts.join('; ')}. Đổi người phụ trách ở Danh mục phiếu trước.`;
  }
}

function cleanName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 60) {
    throw new BadRequestException({ code: 'FEATURE_GROUP_NAME', message: 'Tên nhóm dài 1–60 ký tự.' });
  }
  return name;
}

/** Bỏ trùng, giữ thứ tự hàng trên màn; khóa lạ là lỗi, không lặng lẽ bỏ. */
function cleanTicks(raw: string[]): string[] {
  const unknown = raw.filter((tick) => !(FEATURE_TICKS as readonly string[]).includes(tick));
  if (unknown.length > 0 || raw.length === 0) {
    throw new BadRequestException({ code: 'FEATURE_GROUP_TICKS', message: 'Nhóm phải tick ít nhất một mục hợp lệ.' });
  }
  return FEATURE_TICKS.filter((tick) => raw.includes(tick));
}
