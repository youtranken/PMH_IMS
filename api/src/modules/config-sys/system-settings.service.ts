import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import {
  EDITABLE_SETTINGS,
  editableByKey,
  validateSetting,
  type EditableSetting,
} from './system-config.editable';
import { CONFIG_KEYS } from './system-config.keys';
import { systemConfigTable } from './system-config.schema';
import { SystemConfigService } from './system-config.service';

/** Một dòng trên màn Tham số hệ thống: khai báo + giá trị hiện tại + ai sửa lần cuối. */
export interface SettingView extends Omit<EditableSetting, 'name'> {
  name: string;
  key: string;
  defaultValue: unknown;
  value: unknown;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SettingChange {
  key: string;
  value: unknown;
}

/**
 * Đọc/sửa `system_config` cho màn /admin/settings — CHỈ những khoá có trong
 * `EDITABLE_SETTINGS`. Quyền (SA + step-up) chốt ở controller; ở đây là luật dữ liệu.
 */
@Injectable()
export class SystemSettingsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: SystemConfigService,
    private readonly audit: AuditWriterService,
  ) {}

  async list(): Promise<SettingView[]> {
    const keys = EDITABLE_SETTINGS.map((spec) => CONFIG_KEYS[spec.name].key);
    const rows = await this.db
      .select()
      .from(systemConfigTable)
      .where(inArray(systemConfigTable.key, keys));
    return EDITABLE_SETTINGS.map((spec) => {
      const key = CONFIG_KEYS[spec.name].key;
      const row = rows.find((r) => r.key === key);
      const fallback = CONFIG_KEYS[spec.name].fallback;
      return {
        ...spec,
        key,
        defaultValue: fallback,
        value: row ? row.value : fallback,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
  }

  /**
   * Sửa MỘT lượt nhiều khoá (màn lưu theo nhóm): kiểm HẾT trước, ghi sau, cả lượt trong một
   * transaction cùng các dòng nhật ký (AD-5) — một khoá hỏng thì không khoá nào đổi.
   */
  async update(actor: string, changes: SettingChange[]): Promise<SettingView[]> {
    if (changes.length === 0) {
      throw new BadRequestException({ code: 'SETTING_EMPTY', message: 'Không có thay đổi nào.' });
    }
    const seen = new Set<string>();
    const planned: { spec: EditableSetting; key: string; value: unknown }[] = [];
    for (const change of changes) {
      const spec = editableByKey(change.key);
      if (!spec) {
        throw new BadRequestException({
          code: 'SETTING_NOT_EDITABLE',
          message: `Tham số "${change.key}" không sửa được trên màn này.`,
        });
      }
      if (seen.has(change.key)) {
        throw new BadRequestException({
          code: 'SETTING_DUPLICATE',
          message: `Tham số "${change.key}" gửi hai lần trong một lượt.`,
        });
      }
      seen.add(change.key);
      const checked = validateSetting(spec, change.value);
      if (checked.reason !== null) {
        throw new BadRequestException({
          code: 'SETTING_OUT_OF_RANGE',
          message: `${change.key}: ${checked.reason}`,
        });
      }
      planned.push({ spec, key: change.key, value: checked.value });
    }

    const current = await this.list();
    const valueOf = (key: string) =>
      planned.find((p) => p.key === key)?.value ?? current.find((c) => c.key === key)?.value;
    /*
     * Ràng buộc GIỮA hai khoá: "khẩn" phải sớm hơn "sắp hết hạn". Đảo ngược thì mọi hồ sơ
     * trong khoảng giữa bị tô sai mức, trên cả dashboard lẫn email.
     */
    if (Number(valueOf('expiry.critical_days')) >= Number(valueOf('expiry.warning_days'))) {
      throw new BadRequestException({
        code: 'SETTING_OUT_OF_RANGE',
        message: 'Số ngày "khẩn" phải nhỏ hơn số ngày "sắp hết hạn".',
      });
    }
    /*
     * Thư nhắc người duyệt phải đi TRƯỚC lúc yêu cầu mở két tự hết hạn (Q-15). Đảo lại thì
     * yêu cầu hết hạn khi chưa ai được nhắc, người xin chờ vô ích. Nhắc = 0 là tắt nhắc.
     */
    const reminder = Number(valueOf(CONFIG_KEYS.approvalReminderHours.key));
    const pendingExpire = Number(valueOf(CONFIG_KEYS.breakGlassPendingExpireHours.key));
    if (reminder > 0 && reminder >= pendingExpire) {
      throw new BadRequestException({
        code: 'SETTING_OUT_OF_RANGE',
        message:
          'Giờ nhắc người duyệt phải nhỏ hơn giờ tự hết hạn của yêu cầu mở két — không thì ' +
          'yêu cầu hết hạn trước khi thư nhắc kịp đi.',
      });
    }

    await this.db.transaction(async (tx) => {
      for (const p of planned) {
        const before = current.find((c) => c.key === p.key)?.value;
        await tx
          .insert(systemConfigTable)
          .values({ key: p.key, value: p.value, updatedAt: new Date(), updatedBy: actor })
          .onConflictDoUpdate({
            target: systemConfigTable.key,
            set: { value: p.value, updatedAt: new Date(), updatedBy: actor },
          });
        await this.audit.appendWithin(tx, {
          actor,
          action: 'system_config.updated',
          objectType: 'system_config',
          objectId: p.key,
          detail: { key: p.key, before, after: p.value },
        });
      }
    });
    // Xoá cache SAU khi commit: xoá trước thì một request chen giữa nạp lại giá trị cũ.
    for (const p of planned) this.config.forget(p.key);
    return this.list();
  }
}
