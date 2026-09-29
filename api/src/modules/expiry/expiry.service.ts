import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import { HISTORY_PAGE_LIMIT } from '../../common/history';
import type { Tx } from '../../common/tx';
import { addDays, daysBetween, isoDateInTz, startOfDayInTz } from '../../common/today';
import { SystemConfigService } from '../config-sys/system-config.service';
import type { ExpiryItem, RenewTerms } from '../../common/expiry/expiry-source';
import type { ExpiryKindInfo } from '../../common/expiry/expiry-registry';
import { AuditWriterService } from '../audit/audit-writer.service';
import { renewalHistoryTable } from './expiry.schema';

/** Mục hết hạn kèm số ngày còn lại — server tính một lần, mọi nơi hiển thị giống nhau. */
export interface ExpiryRow extends ExpiryItem {
  daysLeft: number;
  canRenew: boolean;
  /** Hộp Gia hạn hiện ô "Số hợp đồng" + "Chi phí" chỉ khi nguồn này có sổ gia hạn (Q-15). */
  canRenewTerms: boolean;
}

export interface ExpirySummary {
  expired: number;
  critical: number;
  warning: number;
  /** Mục phần mềm đã Hết hạn đang chờ tự Thanh lý (Q-13) — có `autoRetireOn`. */
  autoRetire: number;
}

/** Cột sắp được ở màn "Sắp hết hạn" — sắp ở máy chủ, trước khi cắt trang. */
export const EXPIRY_SORTS = ['end', 'kind', 'label'] as const;
export type ExpirySort = (typeof EXPIRY_SORTS)[number];

/** Bộ lọc ô số: ba nhóm hạn, cộng nhóm "chờ tự thanh lý" (không phải một mức hạn). */
export type ExpiryFilterState = ExpiryLevel | 'autoRetire';

/**
 * Hai ngưỡng "sắp hết hạn", đọc từ `system_config` (AD-11, 0041).
 *
 * Trả kèm mọi câu `list()` để giao diện dùng ĐÚNG hai con số mà server vừa đếm bằng. Không có
 * chúng trong payload thì web phải tự giữ một bản sao — và đó chính là lỗi đang vá.
 */
export interface ExpiryThresholds {
  criticalDays: number;
  warningDays: number;
}

export interface ExpiryQuery {
  /** Cửa sổ nhìn tới, tính bằng ngày. Mặc định `expiry.warning_days` (AD-11). */
  withinDays?: number;
  kinds?: string[];
  /** true = kèm cả mục ĐÃ quá hạn (mặc định có, vì đó là thứ gấp nhất). */
  includeExpired?: boolean;
  /**
   * NHÌN LÙI bao nhiêu ngày để bắt mục đã quá hạn. Mặc định `expiry.look_back_days` (một năm).
   *
   * ===== VÌ SAO MÀN HÌNH VÀ EMAIL PHẢI KHÁC NHAU Ở ĐÂY =====
   *
   * Màn hình là thứ người ta KÉO tới xem: nhìn lùi một năm là đúng, vì mục quá hạn 200 ngày mà
   * chưa ai xử chính là thứ nguy hiểm nhất và phải hiện ra.
   *
   * Email là thứ ĐẨY tới người ta, hằng tuần, mãi mãi. Cùng một mục đó sẽ nằm trong 52 lá thư
   * liên tiếp — một tên miền công ty đã bỏ, một hợp đồng đã chấm dứt, xuất hiện đều đặn cả
   * năm. Không ai xử được nó bằng email (việc phải làm là sửa hồ sơ, ở màn khác), nên nó chỉ
   * dạy người nhận một điều: thư này có thứ không cần đọc. Vài tuần sau cả lá thư vào thùng
   * rác, kể cả những dòng THẬT SỰ gấp.
   */
  expiredWithinDays?: number;
  /**
   * Phân trang MÁY CHỦ (N-01). Bỏ trống cả hai = trả trọn bộ.
   *
   * "Trọn bộ" vẫn phải tồn tại và là mặc định của TẦNG SERVICE: email digest và
   * `GET /expiry/export.xlsx` đều cần đủ dòng, và một cửa mặc định cắt 50 dòng sẽ lặng lẽ
   * xuất thiếu — một file Excel thiếu dòng trông y hệt một file Excel đủ. Cửa HTTP của MÀN
   * HÌNH thì ngược lại: nó luôn truyền `page`/`limit`, xem `expiry.controller.ts`.
   */
  page?: number;
  limit?: number;
  /**
   * Lọc theo NHÓM của ba nút đầu màn: `expired` · `critical` · `warning`.
   *
   * Phép lọc này từng nằm ở client, và chú thích tại chỗ giải thích đúng vì sao được phép:
   * *"Màn này KHÔNG phân trang — API trả về hết — nên lọc ở đây là lọc đúng toàn bộ tập kết
   * quả."* Câu ấy ngừng đúng ngay khi phân trang, nên phép lọc phải đi xuống cùng chuyến —
   * nếu không, bấm "Gấp" chỉ lọc trong 50 dòng đang xem trong khi nút ngay trên đầu đề số 87.
   *
   * `autoRetire` = mục phần mềm đang chờ tự Thanh lý (EX-005).
   */
  state?: ExpiryFilterState | '';
  /** Cột sắp (EX-011) — mặc định ngày hết hạn tăng dần. Sắp TRƯỚC khi cắt trang. */
  sort?: ExpirySort;
  dir?: 'asc' | 'desc';
}

/**
 * Cỗ máy Expiry (FR-012).
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
  kinds(): ExpiryKindInfo[] {
    return this.registry.list();
  }

  /** Hai ngưỡng đang hiệu lực — giao diện đọc để huy hiệu và chip đếm cùng một luật. */
  async thresholds(): Promise<ExpiryThresholds> {
    const [criticalDays, warningDays] = await Promise.all([
      this.config.getNumber('expiryCriticalDays'),
      this.config.getNumber('expiryWarningDays'),
    ]);
    /*
     * Kẹp `critical <= warning`. Cấu hình sai thứ tự (gấp 30, sắp 7) sẽ làm mọi thứ trong
     * khoảng 8..30 vừa là "gấp" vừa vượt trần "sắp" — tức là biến mất khỏi cả ba chip trong
     * khi vẫn hiện đỏ trên hàng. Rơi về `warning = critical` thì ít nhất hai bên vẫn nói
     * cùng một điều.
     */
    return { criticalDays, warningDays: Math.max(warningDays, criticalDays) };
  }

  async list(query: ExpiryQuery): Promise<{
    items: ExpiryRow[];
    /** Tổng số mục khớp cửa sổ — CẢ KHO, không phải số dòng của trang đang trả. */
    total: number;
    summary: ExpirySummary;
    thresholds: ExpiryThresholds;
    /**
     * Nguồn hạn đã lỗi trong lượt này — kết quả THIẾU phần của chúng. Màn hình vẫn hiện phần
     * còn lại; nơi nào cần danh sách đủ (digest, file xuất, trang chủ) phải từ chối tin nó.
     */
    failedKinds: string[];
  }> {
    const today = await this.today();
    const thresholds = await this.thresholds();
    const withinDays = clampWindow(query.withinDays, thresholds.warningDays);
    const from = addDays(
      today,
      -lookBackDays(query, await this.config.getNumber('expiryLookBackDays')),
    );
    const to = addDays(today, withinDays);

    const { items, failed } = await this.registry.collect(from, to, query.kinds);
    const sources = new Map(this.registry.list().map((source) => [source.kind, source]));

    const rows = items.map((item) => ({
      ...item,
      daysLeft: daysBetween(today, item.end),
      canRenew: sources.get(item.kind)?.canRenew ?? false,
      canRenewTerms: sources.get(item.kind)?.canRenewTerms ?? false,
    }));

    /*
     * `items` là MỘT TRANG; `total` và `summary` là CẢ KHO (N-01).
     *
     * Đây là chỗ dễ vá sai nhất của bản phân trang này. Ba con số "Quá hạn / Gấp / Sắp tới"
     * nằm trên NÚT LỌC ở đầu màn — đếm chúng trên trang đang xem thì chúng trả lời câu "có
     * bao nhiêu mục gấp TRONG 50 dòng này", một câu không ai hỏi, hiển thị ở đúng chỗ người
     * ta đọc câu "có bao nhiêu mục gấp". Không gì đỏ, không ai báo lỗi; người ta chỉ lặng lẽ
     * tin vào một con số nhỏ hơn sự thật.
     *
     * Nên `summarize` chạy TRƯỚC khi cắt, và luôn chạy trên `rows` đầy đủ.
     */
    const summary = summarize(rows, thresholds);
    /*
     * THỨ TỰ LÀ BẮT BUỘC: đếm CẢ KHO → lọc nhóm → cắt trang.
     *
     * Đảo hai bước đầu thì ba con số trên nút lọc đổi mỗi lần người dùng bấm vào chính nó —
     * bấm "Gấp" xong thấy "Gấp 8" tụt xuống "Gấp 8 / Quá hạn 0 / Sắp tới 0". Đảo hai bước sau
     * thì phép lọc chỉ chạy trong trang đang xem.
     */
    const state = query.state;
    const picked = sortExpiryRows(
      state ? rows.filter((row) => inState(row, state, thresholds)) : rows,
      query.sort,
      query.dir,
    );
    return {
      items: pageOf(picked, query),
      total: picked.length,
      summary,
      thresholds,
      failedKinds: failed,
    };
  }

  /**
   * Gia hạn: gọi API của MODULE CHỦ rồi ghi lịch sử (AC 3.4).
   * Engine không tự UPDATE bảng của ai — nó còn không biết bảng đó tên gì.
   */
  async renew(
    actor: string,
    kind: string,
    id: string,
    newEnd: string,
    terms: RenewTerms = {},
  ): Promise<void> {
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
     * CHỈ ĐIỀU PHỐI — không tự ghi sổ.
     *
     * Đừng gọi `source.renew()` (commit) rồi mở transaction THỨ HAI để ghi `renewal_history`.
     * Hai lỗi cộng dồn:
     *
     * 1. HAI CỬA, MỘT SỔ. Web có hai nút Gia hạn: màn "Sắp hết hạn" đi qua đây; nút trong
     *    chính trang hồ sơ gọi thẳng `SoftwareService.renew`. Ghi sổ ở đây thì nút kia không
     *    ghi gì: `end_date` đổi, toast xanh, lịch sử hồ sơ có dòng — nhưng báo cáo cuối năm và
     *    khối "gia hạn gần đây" trên dashboard đọc `renewal_history` nên trả rỗng. Bảng
     *    chỉ-thêm: không vá ngược.
     * 2. MẤT SỔ (mẫu N3). `end_date` đã commit mà transaction thứ hai hỏng thì hồ sơ đã gia
     *    hạn nhưng sổ không có dòng nào, và không có đường bù.
     *
     * Phần ghi sổ nằm TRONG transaction của module chủ (`recordRenewalWithin`), nên cả hai
     * cửa dùng chung đúng một đường và một transaction. Ở đây chỉ kiểm tra rồi gọi.
     */
    const hasTerms = !!terms.contract?.trim() || (terms.cost !== undefined && terms.cost !== null);
    if (hasTerms && !source.renewTerms) {
      throw new BadRequestException({
        code: 'EXPIRY_TERMS_UNSUPPORTED',
        message: `Loại "${source.sourceLabel}" không có sổ gia hạn để ghi số hợp đồng và chi phí — bỏ trống hai ô đó.`,
      });
    }
    await source.renew(actor, id, newEnd, hasTerms ? terms : undefined);
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
      /** Hợp đồng + chi phí của riêng lượt này (Q-15). Bỏ trống = chưa khai. */
      contract?: string | null;
      cost?: number | null;
      /** Website của kỳ này (SSL/tên miền). Null = loại hồ sơ không có khái niệm website. */
      websites?: string[] | null;
    },
  ): Promise<void> {
    const contract = entry.contract?.trim() || null;
    const cost = entry.cost ?? null;
    const websites = entry.websites ?? null;
    await tx.insert(renewalHistoryTable).values({ ...entry, contract, cost, websites });
    await this.audit.appendWithin(tx, {
      actor: entry.actor,
      action: 'expiry.renewed',
      objectType: entry.objectKind,
      objectId: entry.objectId,
      detail: { oldEnd: entry.oldEnd, newEnd: entry.newEnd, contract, cost, websites },
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
      .limit(HISTORY_PAGE_LIMIT);
  }

  /**
   * Lượt gia hạn gần đây, lọc được theo khoảng ngày (tab "Đã gia hạn"). `from`/`to` là ngày
   * YYYY-MM-DD, cả hai BAO GỒM, cắt theo `app.timezone` — cùng múi với giờ in trên màn.
   * Không lọc thì 50 lượt mới nhất; có lọc thì trần rộng hơn vì người hỏi "tháng này gia hạn
   * những gì" cần đủ cả tháng.
   */
  async recentRenewals(range: { from?: string; to?: string } = {}) {
    const where: SQL[] = [];
    if (range.from || range.to) {
      const timeZone = await this.config.getString('appTimezone');
      if (range.from) {
        where.push(gte(renewalHistoryTable.createdAt, startOfDayInTz(range.from, timeZone)));
      }
      if (range.to) {
        where.push(
          lt(renewalHistoryTable.createdAt, startOfDayInTz(addDays(range.to, 1), timeZone)),
        );
      }
    }
    return this.db
      .select()
      .from(renewalHistoryTable)
      .where(where.length > 0 ? and(...where) : undefined)
      .orderBy(desc(renewalHistoryTable.createdAt), desc(renewalHistoryTable.id))
      .limit(where.length > 0 ? RENEWALS_RANGE_CAP : RENEWALS_RECENT);
  }

}

/** Tab "Đã gia hạn": số lượt khi không lọc, và trần kỹ thuật khi lọc theo khoảng ngày. */
const RENEWALS_RECENT = 50;
const RENEWALS_RANGE_CAP = 1000;

/**
 * Ba chip đếm — DÙNG ĐÚNG hai ngưỡng mà huy hiệu trên hàng dùng.
 *
 * ===== BẪY: `warning` PHẢI CÓ TRẦN =====
 *
 * Không có TRẦN cho `warning` thì mọi thứ còn hơn 7 ngày đều được đếm là "sắp hết hạn". Với
 * cửa sổ mặc định 30 ngày thì trùng khớp ngẫu nhiên với `expiryLevel()` bên web, nên không ai
 * thấy. Nhưng người dùng đổi cửa sổ thành 90 ngày là hai bên nói khác nhau ngay:
 *
 *     chip:  "40 sắp hết hạn"      (mọi thứ > 7 ngày)
 *     hàng:  40 huy hiệu XÁM 'ok'  (`expiryLevel` gọi > 30 ngày là 'ok')
 *
 * Người đọc thấy một con số cảnh báo và một bảng không có gì cảnh báo. Ba chip cộng lại KHÔNG
 * còn bằng số dòng — và đó là ĐÚNG: chúng đếm "cần chú ý", không đếm "có bao nhiêu dòng".
 */
/** Ba nhóm của màn — và `null` cho mục còn xa hơn ngưỡng "sắp tới". */
export type ExpiryLevel = 'expired' | 'critical' | 'warning';

/**
 * Một mục thuộc nhóm nào — MỘT bản luật, dùng cho cả phép đếm lẫn phép lọc.
 *
 * Tách ra khỏi `summarize` vì có hai nơi hỏi cùng câu ấy (đếm và lọc). Hai bản chép tay của
 * ba nhánh `<0 / <=critical / <=warning` sẽ trôi khỏi nhau ở lần ai đó sửa một bản — như F-09
 * (các bản sao panel Lịch sử đã lệch nhau).
 */
function levelOf(daysLeft: number, thresholds: ExpiryThresholds): ExpiryLevel | null {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= thresholds.criticalDays) return 'critical';
  if (daysLeft <= thresholds.warningDays) return 'warning';
  return null;
}

function summarize(rows: ExpiryRow[], thresholds: ExpiryThresholds): ExpirySummary {
  const summary: ExpirySummary = { expired: 0, critical: 0, warning: 0, autoRetire: 0 };
  for (const row of rows) {
    const level = levelOf(row.daysLeft, thresholds);
    if (level) summary[level] += 1;
    if (row.autoRetireOn) summary.autoRetire += 1;
  }
  return summary;
}

function inState(row: ExpiryRow, state: ExpiryFilterState, thresholds: ExpiryThresholds): boolean {
  return state === 'autoRetire'
    ? Boolean(row.autoRetireOn)
    : levelOf(row.daysLeft, thresholds) === state;
}

const labelCollator = new Intl.Collator('vi');

/**
 * Sắp TRƯỚC khi cắt trang — sắp sau là chỉ đảo chỗ trang đang xem. Mặc định giữ đúng thứ tự
 * "gấp nhất lên đầu" (hết hạn tăng dần). Khoá phụ luôn là ngày hết hạn tăng dần, rồi `id`, để
 * hai lượt hỏi liền nhau cắt trang ra cùng một kết quả.
 */
function sortExpiryRows<T extends Pick<ExpiryRow, 'id' | 'end' | 'kind' | 'label'>>(
  rows: T[],
  sort: ExpirySort | undefined,
  dir: 'asc' | 'desc' | undefined,
): T[] {
  const sign = dir === 'desc' ? -1 : 1;
  const primary = (a: T, b: T): number =>
    sort === 'kind'
      ? a.kind.localeCompare(b.kind)
      : sort === 'label'
        ? labelCollator.compare(a.label, b.label)
        : a.end.localeCompare(b.end);
  return [...rows].sort(
    (a, b) => sign * primary(a, b) || a.end.localeCompare(b.end) || a.id.localeCompare(b.id),
  );
}

/**
 * Cắt một trang — hàm THUẦN.
 *
 * Thiếu cả `page` lẫn `limit` thì KHÔNG cắt: xem chú thích ở `ExpiryQuery.page`.
 *
 * Xin quá trang cuối thì trả RỖNG, không quay vòng về đầu. Quay vòng là cách hỏng tệ nhất ở
 * đây — người dùng bấm "sau", thấy lại đúng dòng đầu, rồi kết luận mình đã đọc hết trong khi
 * còn nguyên phần giữa.
 */
function pageOf(rows: ExpiryRow[], query: ExpiryQuery): ExpiryRow[] {
  if (query.page === undefined && query.limit === undefined) return rows;
  const limit = Math.max(1, Math.trunc(query.limit ?? 50));
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const from = (page - 1) * limit;
  return rows.slice(from, from + limit);
}

/**
 * Nhìn lùi bao nhiêu ngày — hàm THUẦN, có bảng test.
 *
 * `screenDays` = `expiry.look_back_days`: vừa là mặc định của MÀN HÌNH, vừa là trần kẹp.
 *
 * Ba câu trả lời, và cả ba đều đúng ở đúng chỗ của nó:
 *   - `includeExpired: false` → 0, không nhìn lùi tí nào (bộ lọc "chỉ sắp tới" của màn hình).
 *   - có `expiredWithinDays` → đúng con số đó (digest, đọc từ `system_config`).
 *   - còn lại → `screenDays` (mặc định của màn hình).
 *
 * Kẹp về 0..`screenDays`: số âm sẽ đẩy `from` ra TƯƠNG LAI và lặng lẽ giấu mất mọi mục quá
 * hạn — đúng loại hỏng không ai thấy, vì màn hình vẫn có dữ liệu, chỉ thiếu đúng phần nguy
 * hiểm nhất.
 */
export function lookBackDays(
  query: {
    includeExpired?: boolean;
    expiredWithinDays?: number;
  },
  screenDays: number,
): number {
  if (query.includeExpired === false) return 0;
  const raw = query.expiredWithinDays;
  if (raw === undefined || Number.isNaN(raw)) return screenDays;
  return Math.min(screenDays, Math.max(0, Math.trunc(raw)));
}

/**
 * Cửa sổ nhìn tới. Kẹp 1..365 ngày: `?withinDays=99999` sẽ kéo cả kho ra và làm chậm màn,
 * còn 0 thì trả rỗng khiến người dùng tưởng không có gì sắp hết hạn.
 *
 * Mặc định là `expiry.warning_days` (AD-11), không phải số 30 viết cứng: cửa sổ mặc định và
 * ngưỡng "vàng" phải là CÙNG một con số, nếu không thì màn mở ra đã sẵn có hàng nằm ngoài
 * ngưỡng cảnh báo mà vẫn bị gọi tên là sắp hết hạn.
 */
export function clampWindow(value: number | undefined, fallback: number): number {
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.min(365, Math.max(1, Math.trunc(value)));
}

