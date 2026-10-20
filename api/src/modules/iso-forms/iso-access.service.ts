import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import type { UserRole } from '../auth/types';
import { UsersApiService } from '../users/users.api';
import { isoFormOwnerTable } from './iso-forms.schema';
import { ISO_FORM_TYPES, type IsoFormType } from './iso-rules';

export interface IsoActor {
  id: string;
  email: string;
  role: UserRole;
}

export interface IsoPerson {
  id: string;
  email: string;
  fullName: string;
}

export interface FormOwners {
  formType: IsoFormType;
  primary: IsoPerson | null;
  backup: IsoPerson | null;
}

export function isManager(actor: Pick<IsoActor, 'role'>): boolean {
  return actor.role === 'sa' || actor.role === 'admin';
}

/**
 * Người phụ trách từng loại phiếu (Q-28): một chính, một dự phòng. Chỉ hai người đó và SA/Admin
 * được tick / ghi issue / gửi chốt phiếu đó; Member khác chỉ xem. Kiểm ở API, giao diện chỉ ẩn nút.
 */
@Injectable()
export class IsoAccessService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly users: UsersApiService,
  ) {}

  async owners(): Promise<FormOwners[]> {
    const rows = await this.db.select().from(isoFormOwnerTable);
    const people = await this.peopleById();
    return ISO_FORM_TYPES.map((formType) => {
      const row = rows.find((r) => r.formType === formType);
      return {
        formType,
        primary: row?.primaryUserId ? (people.get(row.primaryUserId) ?? null) : null,
        backup: row?.backupUserId ? (people.get(row.backupUserId) ?? null) : null,
      };
    });
  }

  async ownersOf(formType: IsoFormType): Promise<FormOwners> {
    return (await this.owners()).find((o) => o.formType === formType)!;
  }

  async canWrite(actor: IsoActor, formType: IsoFormType): Promise<boolean> {
    if (isManager(actor)) return true;
    const [row] = await this.db.select().from(isoFormOwnerTable).where(eq(isoFormOwnerTable.formType, formType));
    return Boolean(row && (row.primaryUserId === actor.id || row.backupUserId === actor.id));
  }

  async assertCanWrite(actor: IsoActor, formType: IsoFormType): Promise<void> {
    if (await this.canWrite(actor, formType)) return;
    const owners = await this.ownersOf(formType);
    const message =
      owners.primary || owners.backup
        ? `Chỉ người phụ trách phiếu ${formType} (chính hoặc dự phòng) và SA/Admin được ghi phiếu này.`
        : `Phiếu ${formType} chưa có người phụ trách — chỉ SA/Admin thao tác được. Gán người phụ trách ở Danh mục phiếu.`;
    throw new ForbiddenException({ code: 'ISO_NOT_OWNER', message });
  }

  /** Tài khoản còn hoạt động — danh sách chọn người phụ trách. */
  async people(): Promise<IsoPerson[]> {
    return (await this.users.directory())
      .filter((u) => u.status === 'active')
      .map((u) => ({ id: u.id, email: u.email, fullName: u.fullName }));
  }

  async setOwners(
    actor: IsoActor,
    formType: IsoFormType,
    input: { primaryUserId: string | null; backupUserId: string | null },
  ): Promise<FormOwners> {
    if (!isManager(actor)) {
      throw new ForbiddenException({ code: 'ISO_OWNER_MANAGER_ONLY', message: 'Chỉ SA/Admin gán người phụ trách phiếu.' });
    }
    if (input.primaryUserId && input.primaryUserId === input.backupUserId) {
      throw new BadRequestException({
        code: 'ISO_OWNER_SAME_PERSON',
        message: 'Người dự phòng phải khác người phụ trách chính.',
      });
    }
    const active = new Set((await this.people()).map((p) => p.id));
    for (const id of [input.primaryUserId, input.backupUserId]) {
      if (id && !active.has(id)) {
        throw new BadRequestException({
          code: 'ISO_OWNER_NOT_ACTIVE',
          message: 'Tài khoản được chọn không còn hoạt động. Tải lại rồi chọn người khác.',
        });
      }
    }
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(isoFormOwnerTable).where(eq(isoFormOwnerTable.formType, formType)).for('update');
      await tx
        .update(isoFormOwnerTable)
        .set({
          primaryUserId: input.primaryUserId,
          backupUserId: input.backupUserId,
          updatedBy: actor.email,
          updatedAt: new Date(),
        })
        .where(eq(isoFormOwnerTable.formType, formType));
      await this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'iso_owner.updated',
        objectType: 'iso_form_owner',
        detail: {
          formType,
          from: { primaryUserId: before?.primaryUserId ?? null, backupUserId: before?.backupUserId ?? null },
          to: input,
        },
      });
    });
    return this.ownersOf(formType);
  }

  /** Tên hiển thị của người đang thao tác — ghi lên phiếu (Handled của 0208). */
  async nameOf(actor: IsoActor): Promise<string> {
    // Tên rỗng thì rơi về email: ô Handled trống trên phiếu in là thiếu người ký nhận việc.
    return (await this.users.namesByIds([actor.id])).get(actor.id)?.trim() || actor.email;
  }

  private async peopleById(): Promise<Map<string, IsoPerson>> {
    const all = await this.users.directory();
    return new Map(all.map((u) => [u.id, { id: u.id, email: u.email, fullName: u.fullName }]));
  }
}
