import { Injectable, OnModuleInit } from '@nestjs/common';
import { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { ExpiryItem, ExpirySource } from '../../common/expiry/expiry-source';
import { UI_PATHS } from '../../common/ui-paths';
import {
  SERVICE_ACCOUNT_EXPIRY_KIND,
  ServiceAccountService,
  serviceAccountLabel,
} from './service-account.service';

/** Chữ loại trên dòng phụ — cùng chữ với cột Loại của màn danh sách. */
const KIND_SHORT: Record<string, string> = { shared: 'Dùng chung', vpn: 'VPN' };

/**
 * Nguồn hạn "Tài khoản dịch vụ" (AD-7, Q-20): VPN / tài khoản cấp có thời hạn.
 *
 * Chỉ tài khoản đang dùng: ngừng dùng thì không nhắc. Quá hạn chỉ NHẮC — không có lượt quét tự
 * ngừng dùng như phần mềm (Q-13), vì IMS không nối tới hệ thống VPN thật, đóng hồ sơ ở đây
 * không đóng được tài khoản ở đó.
 *
 * Gia hạn được từ màn Sắp hết hạn, đi qua `ServiceAccountService.renew` (luật của module chủ).
 * Không nhận hợp đồng/chi phí: hồ sơ tài khoản dịch vụ không có hai khái niệm đó.
 */
@Injectable()
export class ServiceAccountExpirySource implements ExpirySource, OnModuleInit {
  readonly sourceKind = SERVICE_ACCOUNT_EXPIRY_KIND;
  readonly sourceLabel = 'Tài khoản dịch vụ';

  constructor(
    private readonly registry: ExpirySourceRegistry,
    private readonly accounts: ServiceAccountService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async findExpiring(from: string, to: string): Promise<ExpiryItem[]> {
    const rows = await this.accounts.findExpiringBetween(from, to);
    return rows.map((row) => ({
      id: row.id,
      label: serviceAccountLabel(row),
      code: row.code,
      name: row.name,
      sublabel: [KIND_SHORT[row.kind] ?? row.kind, row.login].filter(Boolean).join(' · ') || null,
      kind: this.sourceKind,
      start: null,
      end: row.endDate!,
      link: UI_PATHS.serviceAccount(row.id),
    }));
  }

  async renew(actor: string, id: string, newEnd: string): Promise<void> {
    await this.accounts.renew(actor, id, newEnd);
  }
}
