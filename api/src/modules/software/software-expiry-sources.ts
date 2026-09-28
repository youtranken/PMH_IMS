import { Injectable, OnModuleInit } from '@nestjs/common';
import { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { ExpiryItem, ExpirySource } from '../../common/expiry/expiry-source';
import { KIND_LABEL, type SoftwareKind } from './software-rules';
import { SoftwareService } from './software.service';
import { UI_PATHS } from '../../common/ui-paths';

/**
 * Nguồn hạn của module `software` (AD-7, story 3.4).
 *
 * Đăng ký MỘT nguồn cho MỖI loại (license, SSL, tên miền, bảo trì, khác) thay vì một nguồn chung:
 * luật digest ở story 3.5 cấu hình theo loại ("SSL sắp hết trong 30 ngày → sếp"), mà bộ lọc
 * của registry chạy trên `sourceKind`. Gộp một nguồn thì không lọc theo loại được nữa.
 *
 * Cả bốn loại đều gia hạn được từ màn Expiry — gọi ngược về `SoftwareService.renew`, tức là
 * đi qua đúng luật của module chủ (không tự UPDATE bảng).
 *
 * Đường truyền ISP KHÔNG đăng ký (Q-04): line không có hạn, sống tới khi thanh lý. Thêm lại
 * nguồn đó là kéo ISP trở vào màn Sắp hết hạn, mail tổng hợp và bảng điều khiển cùng lúc.
 */
@Injectable()
export class SoftwareExpiryRegistrar implements OnModuleInit {
  constructor(
    private readonly registry: ExpirySourceRegistry,
    private readonly software: SoftwareService,
  ) {}

  onModuleInit(): void {
    // "Khác" cũng là nguồn hạn (Q-14): lượt quét Q-13 xử nó như mọi loại, nên phải được nhắc.
    for (const kind of ['license', 'ssl', 'domain', 'maintenance', 'other'] as SoftwareKind[]) {
      this.registry.register(this.softwareSource(kind));
    }
  }

  private softwareSource(kind: SoftwareKind): ExpirySource {
    return {
      sourceKind: kind,
      sourceLabel: KIND_LABEL[kind],
      findExpiring: async (from, to): Promise<ExpiryItem[]> => {
        const rows = await this.software.present(
          (await this.software.findExpiringBetween(from, to)).filter((row) => row.kind === kind),
        );
        return rows.map((row) => ({
          id: row.id,
          label: `${row.code} — ${row.name}`,
          code: row.code,
          name: row.name,
          autoRetireOn: row.autoRetireOn,
          sublabel: row.vendorName,
          kind,
          start: row.startDate,
          end: row.endDate!,
          link: UI_PATHS.software(row.id),
          quietInDigest: row.status === 'expired_ok',
        }));
      },
      renew: async (actor, id, newEnd) => {
        await this.software.renew(actor, id, newEnd);
      },
    };
  }
}
