import { and, desc, inArray, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../database/database.module';

/**
 * TRẦN CHUNG cho mọi panel "Lịch sử" của một hồ sơ (AD-13, AD-15).
 *
 * ===== VÌ SAO LÀ MỘT HẰNG SỐ, KHÔNG PHẢI MỘT HÀM =====
 *
 * Mười bộ đọc lịch sử trong repo chạy cùng một hình dạng — `select … where <khóa ngoại> …
 * orderBy(desc(createdAt)) … limit(N)` — nhưng phần `where` KHÁC NHAU thật: mỗi bảng một cột
 * khóa ngoại, hai bảng ghép hai cột. Gói cả câu vào một hàm generic sẽ phải đánh vật với kiểu
 * của drizzle và đẻ ra một lớp trừu tượng khó đọc hơn chính câu nó thay thế.
 *
 * Thứ THẬT SỰ trôi khỏi nhau là con số. Khi chưa có hằng số chung, đếm được:
 *
 *     approvals · nat-rule · service-account   → KHÔNG CÓ TRẦN NÀO
 *     catalog · expiry                          → 100
 *     devices · ip-address · isp-line · software → 200
 *
 * Ba cái đầu là lỗi thật, không phải chuyện thẩm mỹ: `approval_history` và `nat_rule_history`
 * là bảng CHỈ-THÊM (AD-13) nên chúng chỉ có thể dài ra. Một phiếu duyệt bị nhắc lại nhiều
 * lần, hay một rule NAT sửa đi sửa lại vài năm, sẽ kéo toàn bộ lịch sử về trình duyệt cho một
 * cái panel không ai cuộn hết — và càng dùng lâu càng chậm, đúng lúc lịch sử đáng giá nhất.
 *
 * ===== VÌ SAO 200 =====
 *
 * Đủ để một hồ sơ dùng vài năm vẫn thấy hết phần người ta thực sự đọc, và đủ nhỏ để không
 * bao giờ thành vấn đề. Con số này KHÔNG vào `system_config`: nó không phải luật nghiệp vụ
 * (AD-11) mà là trần kỹ thuật của một cái panel — đổi nó không đổi câu trả lời nào cho người
 * dùng, chỉ đổi số dòng tải về.
 *
 * `history-readers.spec.ts` canh: thêm một bộ đọc lịch sử mà quên trần, hoặc gõ số khác, là
 * test đỏ.
 */
export const HISTORY_PAGE_LIMIT = 200;

/**
 * Gắn HỌ TÊN người làm vào từng dòng lịch sử (`actorName`), giữ nguyên `actor` là email.
 *
 * Bảng lịch sử chỉ lưu email — đúng, vì email là khoá bền còn họ tên đổi được. Nhưng panel
 * đọc "e2e-sa@pmh.com.vn · 23:15" thì người dùng phải tự dịch email ra người. `lookup` là
 * `UsersApiService.namesByEmails` (AD-2): hỏi MỘT lượt cho cả trang, không lượt nào mỗi dòng.
 * Tài khoản đã xoá thì `actorName` là `null` và màn hình rơi về email.
 */
export async function withActorNames<T extends { actor: string }>(
  rows: T[],
  lookup: (emails: string[]) => Promise<Map<string, string>>,
): Promise<(T & { actorName: string | null })[]> {
  if (rows.length === 0) return [];
  const emails = [...new Set(rows.map((row) => row.actor.toLowerCase()))];
  const names = await lookup(emails);
  return rows.map((row) => ({ ...row, actorName: names.get(row.actor.toLowerCase()) ?? null }));
}

/** Người thực hiện của các lượt quét tự động (Q-13) — khác mọi email người dùng. */
const SYSTEM_ACTOR = 'system';

/** Lần gần nhất một hồ sơ được chuyển SANG một trạng thái, đọc từ bảng lịch sử của nó. */
export interface StatusEvent {
  at: Date;
  /** Email người làm, hoặc `system` khi lượt quét tự chuyển. */
  by: string;
  auto: boolean;
  /** Lý do người làm đã ghi (tài khoản dịch vụ bắt ghi), nếu có. */
  reason: string | null;
}

/** Các cột của một bảng lịch sử theo khuôn chung `(<fk>, action, actor, changes, created_at)`. */
export interface HistorySource {
  table: PgTable;
  ownerId: PgColumn;
  actor: PgColumn;
  changes: PgColumn;
  createdAt: PgColumn;
}

/**
 * Lần chuyển sang `status` GẦN NHẤT của từng hồ sơ trong `ids` — MỘT câu cho cả mẻ.
 *
 * Mọi bộ ghi lịch sử đổi trạng thái đều ghi `changes.status = { before, after }` (sửa tay, nút
 * thanh lý, lượt quét tự động), nên "chuyển sang X" đọc được như nhau ở mọi bảng mà không phải
 * biết tên `action` riêng của từng module. Hồ sơ nhập thẳng ở trạng thái đó thì không có dòng
 * nào và vắng khỏi Map — bên gọi tự quyết lùi về đâu.
 *
 * Mỗi module gọi hàm này trên BẢNG CỦA CHÍNH NÓ (AD-3); module khác hỏi qua `*.api.ts`.
 */
export async function latestStatusEvents(
  db: Database,
  source: HistorySource,
  ids: string[],
  status: string,
): Promise<Map<string, StatusEvent>> {
  const out = new Map<string, StatusEvent>();
  if (ids.length === 0) return out;
  const rows = await db
    .selectDistinctOn([source.ownerId], {
      ownerId: source.ownerId,
      actor: source.actor,
      createdAt: source.createdAt,
      reason: sql<string | null>`${source.changes} -> 'reason' ->> 'after'`,
    })
    .from(source.table)
    .where(
      and(
        inArray(source.ownerId, ids),
        sql`${source.changes} -> 'status' ->> 'after' = ${status}`,
      ),
    )
    .orderBy(source.ownerId, desc(source.createdAt));
  for (const row of rows) {
    const by = String(row.actor);
    out.set(String(row.ownerId), {
      at: row.createdAt as Date,
      by,
      auto: by === SYSTEM_ACTOR,
      reason: row.reason ?? null,
    });
  }
  return out;
}
