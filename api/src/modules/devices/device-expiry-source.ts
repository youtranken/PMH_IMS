import { Injectable, OnModuleInit } from '@nestjs/common';
import { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { ExpiryItem, ExpirySource } from '../../common/expiry/expiry-source';
import { DevicesService } from './devices.service';
import { UI_PATHS } from '../../common/ui-paths';

/**
 * Nguồn hạn "bảo hành thiết bị" (AD-7).
 *
 * KHÔNG có hàm `renew`: bảo hành do nhà cung cấp quyết, không phải thứ mình bấm một nút là
 * gia hạn. Đổi hạn bảo hành thì sửa trong hồ sơ thiết bị, và lần sửa đó vào lịch sử thiết bị.
 */
@Injectable()
export class DeviceExpirySource implements ExpirySource, OnModuleInit {
  readonly sourceKind = 'warranty';
  readonly sourceLabel = 'Bảo hành thiết bị';

  constructor(
    private readonly registry: ExpirySourceRegistry,
    private readonly devices: DevicesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async findExpiring(from: string, to: string): Promise<ExpiryItem[]> {
    const rows = await this.devices.findWarrantyExpiring(from, to);
    return rows.map((row) => ({
      id: row.id,
      label: `${row.code} — ${row.name}`,
      code: row.code,
      name: row.name,
      sublabel: [row.deviceTypeName, row.siteCode].filter(Boolean).join(' · ') || null,
      kind: this.sourceKind,
      start: row.warrantyStart,
      end: row.warrantyEnd!,
      link: UI_PATHS.device(row.id),
    }));
  }
}
