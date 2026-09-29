import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { escapeLike } from '../../common/sql';
import { SystemConfigService } from '../config-sys/system-config.service';
import { UsersApiService } from '../users/users.api';
import {
  AuditObjectLabelRegistry,
  auditObjectKey,
} from '../../common/audit-object-labels.registry';
import { SECURITY_AUDIT_ACTIONS } from './security-actions';

export interface AuditQuery {
  actor?: string;
  action?: string;
  objectType?: string;
  objectId?: string;
  /** Chỉ lấy sự kiện an ninh (`SECURITY_AUDIT_ACTIONS`). */
  security?: boolean;
  /** Ngày YYYY-MM-DD theo `app.timezone` (tùy chọn) — from inclusive, to inclusive (+1 ngày). */
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface AuditRow {
  id: string;
  actor: string;
  /** Tên người thao tác (join users theo actor=sub); null cho system/SA → FE tự dịch. */
  actorName: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  /**
   * Nhãn người đọc được của đối tượng (email, mã thiết bị, tên secret · chủ thể…) và đường tới
   * hồ sơ — do module CHỦ SỞ HỮU gọi tên qua `AuditObjectLabelRegistry` (AD-2). `null` khi
   * loại chưa ai gọi tên hoặc hồ sơ đã bị xoá: màn hiện loại + UUID như cũ.
   */
  objectLabel: string | null;
  objectPath: string | null;
  /**
   * "Từ đâu" của NFR-03. `null` cho các dòng do job nền sinh ra (outbox relay, cron hết hạn)
   * — đó là câu trả lời đúng, không phải thiếu dữ liệu — và cho MỌI dòng ghi trước 08/09,
   * khi cột này còn NULL trên 100% số dòng (rà soát 07/09, #3).
   */
  ip: string | null;
  detail: unknown;
  createdAt: string;
}

/** Viewer audit log (6.2) — CHỈ đọc (AD-10 append-only); ranh giới ngày theo `app.timezone`. */
/**
 * Trần của câu đếm. 10.000 là con số người đọc còn dùng được ("quá nhiều, lọc hẹp lại"),
 * và đủ nhỏ để câu đếm luôn dừng sớm dù bảng có bao nhiêu triệu dòng.
 *
 * KHÔNG vào `system_config`: AD-11 dành cho tham số NGHIỆP VỤ (ngưỡng hạn, số lần sai được
 * phép). Đây là một cái phanh kỹ thuật, đổi nó không đổi luật gì của công ty.
 */
export const COUNT_CAP = 10_000;

@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly users: UsersApiService,
    private readonly config: SystemConfigService,
    private readonly objectLabels: AuditObjectLabelRegistry,
  ) {}

  async listAudit(q: AuditQuery): Promise<{
    items: AuditRow[];
    total: number;
    /** `true` = còn nhiều hơn `total`; màn hình phải hiện "10.000+" chứ không phải một con số. */
    totalCapped: boolean;
    page: number;
    pageSize: number;
  }> {
    /*
     * MỌI cột phải gắn bí danh `a.` — cả hai câu dưới đều `FROM audit_log a`.
     *
     * Bản trước viết cột trần (`created_at >= ...`). Câu đếm không JOIN nên chạy được, nhưng
     * câu lấy dữ liệu có `LEFT JOIN users u` và `users` CŨNG có cột `created_at` → Postgres
     * ném 42702 "column reference created_at is ambiguous" mỗi khi người dùng lọc theo ngày.
     *
     * Lỗi này bị lỗi `u.sub` che khuất suốt 9 epic: join sai cột chết trước (42703) nên không
     * ai chạm tới được lớp thứ hai. Sửa lớp một xong, E2E lộ ra ngay lớp hai.
     */
    /*
     * Ranh giới ngày theo `app.timezone` (AD-11), không viết cứng: màn hiển thị giờ theo khóa
     * đó, nên lọc "hôm nay" phải cắt ngày theo CÙNG khóa — lệch nhau là dòng lúc 23h hiện trên
     * màn mà lọc theo ngày thì biến mất.
     */
    const timeZone = q.from || q.to ? await this.config.getString('appTimezone') : null;
    /*
     * `escapeLike`: người điều tra dán nguyên email/mã vào ô lọc, và `_` trong email
     * (`le_minh@…`) là ký tự đại diện của LIKE — không escape thì nó khớp cả `lexminh@…`,
     * tức nhật ký trả về hoạt động của NGƯỜI KHÁC dưới tên người đang bị điều tra.
     */
    const conds = [
      q.actor ? sql`a.actor ILIKE ${`%${escapeLike(q.actor)}%`}` : null,
      q.action ? sql`a.action = ${q.action}` : null,
      q.security
        ? sql`a.action IN (${sql.join(
            SECURITY_AUDIT_ACTIONS.map((code) => sql`${code}`),
            sql`, `,
          )})`
        : null,
      q.objectType ? sql`a.object_type = ${q.objectType}` : null,
      q.objectId ? sql`a.object_id ILIKE ${`%${escapeLike(q.objectId)}%`}` : null,
      /*
       * from 00:00, to inclusive → < (to + 1 ngày) 00:00, cả hai theo `app.timezone`.
       * `::timestamp` bắt buộc: `date AT TIME ZONE` bị Postgres ép sang `timestamptz` theo
       * múi của PHIÊN rồi đổi NGƯỢC chiều, nên chỉ ra đúng khi múi phiên trùng `app.timezone`.
       */
      q.from ? sql`a.created_at >= (${q.from}::date::timestamp AT TIME ZONE ${timeZone})` : null,
      q.to ? sql`a.created_at < ((${q.to}::date + 1)::timestamp AT TIME ZONE ${timeZone})` : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);
    const where = conds.length > 0 ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    const offset = (q.page - 1) * q.pageSize;
    /*
     * TÊN NGƯỜI THAO TÁC TRA QUA `UsersApiService`, KHÔNG JOIN BẢNG `users` (A-07, vá 21/09).
     *
     * Bản trước viết `LEFT JOIN users u ON u.email = a.actor` ngay trong câu SQL này. AD-2
     * cấm tường minh — `users.api.ts` còn viết đúng câu bị vi phạm — nhưng nó sống chín epic
     * vì không cổng nào nhìn thấy: eslint khớp CHUỖI IMPORT (ở đây không có import nào),
     * `dependency-cruiser` khớp ĐƯỜNG DẪN ĐÃ RESOLVE (một câu SQL không resolve thành gì cả).
     *
     * Và cái giá của việc tự suy đoán lược đồ của module khác đã được trả hai lần, cả hai
     * đều ghi lại ở đây: bản đầu join `u.sub = a.actor` — bảng `users` chưa bao giờ có cột
     * `sub`, đó là mảnh sót của QLTS mà AD-12 dặn phải grep bỏ — nên Postgres ném 42703 và
     * endpoint này 500 ở MỌI lần gọi, suốt chín epic, không gì đỏ. Lần thứ hai là `created_at`
     * mơ hồ giữa hai bảng, vỡ mỗi lượt lọc theo ngày.
     *
     * Một câu hỏi thêm cho mỗi trang, không phải mỗi dòng: gom email distinct của trang rồi
     * hỏi một lượt. Viewer hiện 50 dòng và phần lớn do vài người thao tác.
     *
     * `ad2-raw-sql.spec.ts` nay canh chỗ này — cổng thứ ba, cho đúng cửa mà hai cổng kia mù.
     */
    const [items, totalRows] = await Promise.all([
      this.db.execute<{
        id: string;
        actor: string;
        action: string;
        object_type: string | null;
        object_id: string | null;
        ip: string | null;
        detail: unknown;
        created_at: string;
      }>(sql`
        SELECT a.id, a.actor, a.action,
               a.object_type, a.object_id, a.ip, a.detail, a.created_at
        FROM audit_log a
        ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${q.pageSize} OFFSET ${offset}
      `),
      /*
       * ĐẾM CÓ TRẦN, KHÔNG ĐẾM TOÀN BẢNG.
       *
       * `audit_log` là bảng CHỈ-THÊM giữ VĨNH VIỄN (NFR-03) — nó chỉ có thể to lên, không bao
       * giờ nhỏ lại. `count(*)` không có `WHERE` (mở màn lần đầu, không lọc gì) bắt Postgres
       * quét trọn bảng cho MỖI lần bấm sang trang, và cái giá đó lớn lên mãi mãi. Đây là loại
       * chậm không ai để ý lúc viết và không ai gỡ được sau hai năm chạy.
       *
       * `LIMIT` trong câu con là thứ chặn công việc lại: Postgres dừng ngay khi gom đủ
       * `COUNT_CAP + 1` dòng khớp, bất kể bảng có bao nhiêu dòng. Không cần index, không cần
       * `ORDER BY`.
       *
       * Đổi lại là con số có trần, và điều đó phải nói ra chứ không giấu: `totalCapped` để màn
       * hình hiện "10.000+". Một con số sai mà trông như số thật thì tệ hơn hẳn một con số
       * thành thật rằng nó bị cắt — nhật ký an ninh là chỗ người ta đếm để đối chiếu.
       */
      this.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n
        FROM (SELECT 1 FROM audit_log a ${where} LIMIT ${COUNT_CAP + 1}) capped
      `),
    ]);
    const counted = totalRows.rows[0]?.n ?? 0;

    /*
     * Hỏi tên theo MẺ. Map trả về đã hạ chữ thường vì `users.email` là `citext`: DB khớp
     * không phân biệt hoa-thường, còn `Map.get()` thì có — tra bằng đúng chuỗi trong `actor`
     * sẽ hụt những hàng chỉ khác nhau cái chữ hoa, và hiện ra như "không có tên".
     */
    const actors = [...new Set(items.rows.map((r) => r.actor))];
    const [names, labels] = await Promise.all([
      this.users.namesByEmails(actors),
      this.objectLabels.labelsFor(
        items.rows.map((r) => ({ objectType: r.object_type, objectId: r.object_id })),
      ),
    ]);
    const labelOf = (type: string | null, id: string | null) =>
      type && id ? labels.get(auditObjectKey(type, id.toLowerCase())) ?? null : null;

    return {
      items: items.rows.map((r) => ({
        id: r.id,
        actor: r.actor,
        /*
         * `null` cho actor không phải người dùng trong sổ — job nền (`system`), tài khoản đã
         * xóa. Đó là câu trả lời ĐÚNG, không phải dữ liệu thiếu: FE tự dịch.
         */
        actorName: names.get(r.actor.toLowerCase()) ?? null,
        action: r.action,
        objectType: r.object_type,
        objectId: r.object_id,
        objectLabel: labelOf(r.object_type, r.object_id)?.label ?? null,
        objectPath: labelOf(r.object_type, r.object_id)?.path ?? null,
        ip: r.ip,
        detail: r.detail,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total: Math.min(counted, COUNT_CAP),
      totalCapped: counted > COUNT_CAP,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * Distinct action cho dropdown lọc (AC3) — "loose index scan", KHÔNG quét toàn bảng.
   *
   * ===== VÌ SAO KHÔNG PHẢI `SELECT DISTINCT` =====
   *
   * `audit_log` là bảng CHỈ-THÊM giữ vĩnh viễn (NFR-03): nó chỉ có thể to lên. `SELECT
   * DISTINCT action` đọc MỌI dòng đã từng ghi để trả về chừng 60 giá trị cho một ô chọn —
   * chi phí tăng tuyến tính theo tuổi hệ thống, cho một câu trả lời gần như không đổi.
   *
   * Câu đệ quy dưới đây là mẫu "loose index scan" chuẩn của Postgres (Postgres < 18 không có
   * skip scan sẵn): lấy giá trị nhỏ nhất, rồi mỗi vòng nhảy tới giá trị KẾ TIẾP LỚN HƠN bằng
   * `audit_log_action_idx` (migration 0042). Chi phí thành O(số giá trị khác nhau × log n)
   * thay vì O(số dòng) — với 60 hành động thì đó là 60 lần dò index, bất kể bảng có một nghìn
   * hay một tỷ dòng.
   */
  async distinctActions(): Promise<string[]> {
    const rows = await this.db.execute<{ action: string }>(sql`
      WITH RECURSIVE walk AS (
        (SELECT action FROM audit_log ORDER BY action LIMIT 1)
        UNION ALL
        SELECT (
          SELECT a.action FROM audit_log a
          WHERE a.action > walk.action
          ORDER BY a.action
          LIMIT 1
        )
        FROM walk
        WHERE walk.action IS NOT NULL
      )
      SELECT action FROM walk WHERE action IS NOT NULL ORDER BY action
    `);
    return rows.rows.map((r) => r.action);
  }
}
