import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { Tx } from '../../common/tx';
import { addDays, daysBetween, isoDateInTz } from '../../common/today';
import { SystemConfigService } from '../config-sys/system-config.service';
import type { ExpiryItem } from '../../common/expiry/expiry-source';
import { AuditWriterService } from '../audit/audit-writer.service';
import { renewalHistoryTable } from './expiry.schema';

/** Mục hết hạn kèm số ngày còn lại — server tính một lần, mọi nơi hiển thị giống nhau. */
export interface ExpiryRow extends ExpiryItem {
  daysLeft: number;
  canRenew: boolean;
}

export interface ExpirySummary {
  expired: number;
  critical: number;
  warning: number;
}

export interface ExpiryQuery {
  /** Cửa sổ nhìn tới, tính bằng ngày. Mặc định 30. */
  withinDays?: number;
  kinds?: string[];
  /** true = kèm cả mục ĐÃ quá hạn (mặc định có, vì đó là thứ gấp nhất). */
  includeExpired?: boolean;
}

/**
 * Cỗ máy Expiry (story 3.4, FR-012).
 *
 * Engine KHÔNG biết bảng nào tồn tại: nó chỉ gọi provider đã đăng ký (AD-7). Thêm một loại
 * có hạn ở epic sau (chứng chỉ, hợp đồng thuê máy) chỉ là thêm một provider, không sửa
 * một dòng nào ở đây.
 */
@Injectable()
export class ExpiryService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly registry: ExpirySourceRegistry,
    private readonly audit: AuditWriterService,
    private readonly config: SystemConfigService,
  ) {}

  /**
   * "Hôm nay" theo múi giờ cấu hình (AD-11: `app.timezone` nằm trong system_config, không
   * viết cứng). Dùng UTC ở đây là lệch một ngày suốt buổi sáng — xem `common/today.ts`.
   */
  private async today(): Promise<string> {
    return isoDateInTz(await this.config.getString('appTimezone'));
  }

  /** Các loại nguồn đang có — màn Expiry dựng bộ lọc từ đây, không viết cứng danh sách. */
  kinds(): { kind: string; label: string; canRenew: boolean }[] {
    return this.registry.list();
  }

  async list(query: ExpiryQuery): Promise<{
    items: ExpiryRow[];
    summary: ExpirySummary;
  }> {
    const today = await this.today();
    const withinDays = clampWindow(query.withinDays);
    // Nhìn lùi 1 năm để bắt cả thứ ĐÃ quá hạn mà chưa ai xử — đó mới là thứ nguy hiểm.
    const from = query.includeExpired === false ? today : addDays(today, -365);
    const to = addDays(today, withinDays);

    const items = await this.registry.collect(from, to, query.kinds);
    const renewable = new Set(
      this.registry
        .list()
        .filter((source) => source.canRenew)
        .map((source) => source.kind),
    );

    const rows = items.map((item) => ({
      ...item,
      daysLeft: daysBetween(today, item.end),
      canRenew: renewable.has(item.kind),
    }));

    return { items: rows, summary: summarize(rows) };
  }

  /**
   * Gia hạn: gọi API của MODULE CHỦ rồi ghi lịch sử (AC 3.4).
   * Engine không tự UPDATE bảng của ai — nó còn không biết bảng đó tên gì.
   */
  async renew(actor: string, kind: string, id: string, newEnd: string): Promise<void> {
    const source = this.registry.find(kind);
    if (!source) {
      throw new NotFoundException({
        code: 'EXPIRY_KIND_UNKNOWN',
        message: `Không có nguồn hạn nào tên "${kind}".`,
      });
    }
    if (!source.renew) {
      throw new BadRequestException({
        code: 'EXPIRY_NOT_RENEWABLE',
        message: `Loại "${source.sourceLabel}" không gia hạn được từ màn này — sửa trực tiếp trong hồ sơ.`,
      });
    }

    /*
     * CHỈ ĐIỀU PHỐI — không tự ghi sổ nữa (rà soát 07/09, #7).
     *
     * Bản trước gọi `source.renew()` (commit), rồi mở transaction THỨ HAI để ghi
     * `renewal_history`. Hai lỗi cộng dồn:
     *
     * 1. HAI CỬA, MỘT SỔ. Web có hai nút Gia hạn: màn "Sắp hết hạn" đi qua đây và ghi sổ; nút
     *    trong chính trang hồ sơ gọi thẳng `SoftwareService.renew` và KHÔNG ghi gì. `end_date`
     *    đổi, toast xanh, lịch sử hồ sơ có dòng — nhưng báo cáo cuối năm và khối "gia hạn gần
     *    đây" trên dashboard đọc `renewal_history` nên trả rỗng. Bảng chỉ-thêm: không vá ngược.
     * 2. MẤT SỔ (mẫu N3). `end_date` đã commit mà transaction thứ hai hỏng thì hồ sơ đã gia
     *    hạn nhưng sổ không có dòng nào, và không có đường bù.
     *
     * Nay phần ghi sổ nằm TRONG transaction của module chủ (`recordRenewalWithin`), nên cả hai
     * cửa dùng chung đúng một đường và một transaction. Ở đây chỉ còn kiểm tra rồi gọi.
     */
    await source.renew(actor, id, newEnd);
  }

  /**
   * Ghi một lượt gia hạn vào `renewal_history` — TRONG transaction của module chủ.
   *
   * `expiry` là chủ sở hữu bảng này (AD-3), nên câu INSERT phải nằm ở đây; nhưng thời điểm ghi
   * thuộc về module chủ, vì chỉ nó biết lượt gia hạn có thành công hay không. Cửa này là cách
   * dung hòa: chủ bảng giữ câu lệnh, module chủ giữ transaction.
   *
   * Gọi qua `ExpiryApiService` (AD-2). Đây là chiều nghiệp vụ → nền, hợp lệ; chiều ngược lại
   * vẫn đi qua sổ đăng ký ở `common` như cũ, `expiry` không biết module nào tồn tại.
   */
  async recordRenewalWithin(
    tx: Tx,
    entry: {
      objectKind: string;
      objectId: string;
      label: string;
      oldEnd: string | null;
      newEnd: string;
      actor: string;
    },
  ): Promise<void> {
    await tx.insert(renewalHistoryTable).values(entry);
    await this.audit.appendWithin(tx, {
      actor: entry.actor,
      action: 'expiry.renewed',
      objectType: entry.objectKind,
      objectId: entry.objectId,
      detail: { oldEnd: entry.oldEnd, newEnd: entry.newEnd },
    });
  }

  /** Lịch sử gia hạn của một hồ sơ — trang chi tiết của module chủ có thể hỏi qua api. */
  async historyFor(kind: string, id: string) {
    return this.db
      .select()
      .from(renewalHistoryTable)
      .where(
        and(eq(renewalHistoryTable.objectKind, kind), eq(renewalHistoryTable.objectId, id)),
      )
      .orderBy(desc(renewalHistoryTable.createdAt))
      .limit(100);
  }

  /** Toàn bộ lượt gia hạn gần đây — dashboard sếp (Epic 7) và báo cáo năm. */
  async recentRenewals(limit = 50) {
    return this.db
      .select()
      .from(renewalHistoryTable)
      .orderBy(desc(renewalHistoryTable.createdAt))
      .limit(limit);
  }

}

/** Ngưỡng khớp `web/src/lib/expiry.ts` — luật "sắp hết hạn" của hệ thống chỉ có một. */
const CRITICAL_DAYS = 7;

function summarize(rows: ExpiryRow[]): ExpirySummary {
  const summary: ExpirySummary = { expired: 0, critical: 0, warning: 0 };
  for (const row of rows) {
    if (row.daysLeft < 0) summary.expired += 1;
    else if (row.daysLeft <= CRITICAL_DAYS) summary.critical += 1;
    else summary.warning += 1;
  }
  return summary;
}

/**
 * Cửa sổ nhìn tới. Kẹp 1..365 ngày: `?withinDays=99999` sẽ kéo cả kho ra và làm chậm màn,
 * còn 0 thì trả rỗng khiến người dùng tưởng không có gì sắp hết hạn.
 */
function clampWindow(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 30;
  return Math.min(365, Math.max(1, Math.trunc(value)));
}

