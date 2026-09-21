import { randomBytes } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { SystemConfigService } from '../config-sys/system-config.service';
import { SweepService } from '../queue/sweep.service';
import { sessionsTable } from './sessions.schema';

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  ip: string | null;
  userAgent: string | null;
  steppedUpAt: Date | null;
  stepupFailures: number;
  totpPending: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Phiên server-side (AD-8). Cookie chỉ mang id; mọi quyết định sống/chết đọc từ DB
 * để SA đá phiên là chết NGAY, không chờ token hết hạn.
 */
@Injectable()
export class SessionService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: SystemConfigService,
    private readonly sweep: SweepService,
  ) {}

  /**
   * CẮM LƯỢT DỌN VÀO SWEEP (D-02, vá 21/09).
   *
   * `purgeOld()` có từ lâu và chú thích của nó ghi hẳn "Gọi từ sweep (worker)" — nhưng không
   * ai gọi. Một hàm dọn không ai gọi trông y hệt một hàm dọn đang chạy: mã đọc vào thì yên
   * tâm, bảng thì lớn mãi. Đúng lớp lỗi mà cả đợt rà soát này gặp đi gặp lại — một cơ chế
   * đứng đó đủ hình hài nhưng không có ai bật công tắc.
   */
  onModuleInit(): void {
    this.sweep.register({ name: 'session-purge', run: () => this.purgeOld().then(() => undefined) });
  }

  /** Tạo phiên mới TRONG transaction đăng nhập (AD-5). */
  async createWithin(
    tx: Tx,
    params: {
      userId: string;
      ip: string | null;
      userAgent: string | null;
      absoluteHours: number;
      totpPending: boolean;
    },
  ): Promise<SessionRecord> {
    const rows = await tx
      .insert(sessionsTable)
      .values({
        userId: params.userId,
        csrfToken: randomBytes(32).toString('hex'),
        ip: params.ip,
        userAgent: params.userAgent,
        totpPending: params.totpPending,
        absoluteExpiresAt: new Date(Date.now() + params.absoluteHours * 3_600_000),
      })
      .returning();
    return rows[0];
  }

  async find(id: string): Promise<SessionRecord | null> {
    const rows = await this.db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
    return rows[0] ?? null;
  }

  async touch(id: string): Promise<void> {
    await this.db
      .update(sessionsTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessionsTable.id, id));
  }

  /**
   * Qua TOTP đăng nhập: bỏ cờ chờ + đóng dấu step-up trong CÙNG transaction (AD-5).
   *
   * ===== VÌ SAO VẪN ĐÓNG DẤU `steppedUpAt` — ĐÃ THỬ BỎ VÀ HOÀN LẠI (09/09) =====
   *
   * Rà soát 07/09 (mục 6, "Bảo mật") đề nghị bỏ, với lập luận đúng: yếu tố thứ hai nên được
   * hỏi TẠI THỜI ĐIỂM mở bí mật, không thừa hưởng từ thao tác đăng nhập vừa xong.
   *
   * Tôi đã bỏ thử, và nó va vào một ràng buộc mà đề nghị đó không tính tới: **chống replay
   * TOTP**. Người dùng vừa dùng mã 6 số để đăng nhập; hệ thống từ chối chính mã đó lần thứ
   * hai (NFR-01). Nên nếu mở két đòi step-up ngay sau khi đăng nhập, họ KHÔNG có mã hợp lệ
   * nào để gõ — phải chờ hết chu kỳ 30 giây rồi mới mở được két. Mỗi lần. Sau mỗi lần đăng
   * nhập.
   *
   * Một hàng rào bắt người dùng ngồi đợi đồng hồ là hàng rào sẽ bị tìm cách lách: người ta sẽ
   * xin nới grace, hoặc tệ hơn, xin bỏ 2 lớp. Đổi một rủi ro nhỏ lấy một rủi ro lớn.
   *
   * Rủi ro còn lại (máy vừa đăng nhập bị người khác ngồi vào) được xử ở chỗ đúng của nó: độ
   * dài grace, vốn đã nằm trong `system_config` theo FR-022 — hạ nó xuống là một dòng cấu
   * hình, không phải một lần sửa code.
   *
   * ĐỪNG "sửa" lại chỗ này mà không giải quyết trước bài toán replay ở trên.
   */
  async completeTotpWithin(tx: Tx, id: string): Promise<void> {
    await tx
      .update(sessionsTable)
      .set({ totpPending: false, steppedUpAt: new Date() })
      .where(eq(sessionsTable.id, id));
  }

  /**
   * FR-022: đóng dấu vừa gõ TOTP — grace tính từ mốc này. Gõ đúng xóa sạch bộ đếm sai.
   *
   * LUÔN trong transaction đang chạy (AD-5), không có bản chạy-trên-pool. Bản trước commit
   * NGAY, rồi `stepUp()` mới ghi mốc chống-replay bằng một lượt ghi thứ hai: quyền mở két đã
   * cấp xong trong khi mã 6 số vừa dùng vẫn còn hiệu lực. Xem `setTotpLastTimestepWithin`.
   */
  async markSteppedUpWithin(tx: Tx, id: string): Promise<void> {
    await tx
      .update(sessionsTable)
      .set({ steppedUpAt: new Date(), stepupFailures: 0 })
      .where(eq(sessionsTable.id, id));
  }

  /**
   * Xoá bộ đếm sai mà KHÔNG cấp quyền gì — dùng cho cửa xác thực lại ở màn cài 2 lớp (A-02).
   *
   * Vì sao không gọi thẳng `markSteppedUpWithin`: hàm đó còn đóng dấu `stepped_up_at`, tức
   * gõ đúng MẬT KHẨU ở cửa cài 2 lớp sẽ mở luôn cửa KÉT — mà cửa két được dựng để đòi đúng
   * một thứ khác: mã 6 số trên điện thoại. Ba cửa chia nhau BỘ ĐẾM, không chia nhau QUYỀN.
   *
   * Vì sao phải có nó (thiếu tới 21/09): cửa enroll chỉ biết CỘNG. Người gõ nhầm bốn lần rồi
   * gõ đúng vẫn mang `stepup_failures = 4` suốt đời phiên, và lần gõ hụt mã đầu tiên sau đó
   * thu hồi phiên kèm câu "Gõ sai mã 5 lần" — sai sự thật với người vừa sai một lần. Docblock
   * ngay dưới đây hứa "LIÊN TIẾP"; không có hàm này thì nó là tích luỹ vĩnh viễn.
   */
  async clearStepUpFailuresWithin(tx: Tx, id: string): Promise<void> {
    await tx
      .update(sessionsTable)
      .set({ stepupFailures: 0 })
      .where(eq(sessionsTable.id, id));
  }

  /**
   * Gõ sai mã step-up: tăng bộ đếm và trả về số lần sai LIÊN TIẾP sau khi tăng.
   *
   * Tăng bằng SQL (`+ 1` trên chính cột) chứ không đọc-rồi-ghi: hai request gõ sai cùng lúc
   * mà đọc-rồi-ghi thì cả hai cùng thấy 3 và cùng ghi 4 — kẻ tấn công bắn song song là bộ
   * đếm gần như đứng yên.
   */
  async registerStepUpFailure(id: string): Promise<number> {
    const rows = await this.db
      .update(sessionsTable)
      .set({ stepupFailures: sql`${sessionsTable.stepupFailures} + 1` })
      .where(eq(sessionsTable.id, id))
      .returning({ failures: sessionsTable.stepupFailures });
    return rows[0]?.failures ?? 0;
  }

  /**
   * Thu hồi phiên — LUÔN trong transaction đang chạy (AD-5). Không có bản chạy-trên-pool.
   *
   * Từng có một `revoke(id, reason)` chạy thẳng trên pool, và chính chú thích của nó cảnh báo
   * rằng nó commit kể cả khi transaction ngoài rollback. Rà soát 07/09 tìm thấy đúng ba nơi
   * dùng nó — `killSession`, `stepUp` brute-force, `logout` — và cả ba đều là mẫu N3: phiên
   * chết trước, dòng audit ghi sau ở một transaction khác, transaction đó hỏng thì phiên đã
   * mất mà không còn gì nói ai đá và đá lúc nào (`audit_log` chỉ-thêm, không có đường bù).
   *
   * Sửa xong ba nơi thì hàm kia còn 0 chỗ gọi. Giữ lại một hàm mồ côi mà tài liệu của nó nói
   * "đừng dùng" chỉ là để dành sẵn cái bẫy cho người viết đường thu hồi thứ tư. Nên xóa hẳn:
   * bây giờ muốn thu hồi phiên thì buộc phải có `tx` trong tay (rà soát 08/09, #2).
   */
  async revokeWithin(tx: Tx, id: string, reason: string): Promise<void> {
    await tx
      .update(sessionsTable)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.revokedAt)));
  }

  /**
   * NFR-01: đổi mật khẩu / reset MFA / SA khóa user → mọi phiên của user chết NGAY.
   * Chạy trong transaction của hành động gây ra nó (AD-5).
   */
  async revokeAllForUserWithin(
    tx: Tx,
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const rows = await tx
      .update(sessionsTable)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(sessionsTable.userId, userId),
          isNull(sessionsTable.revokedAt),
          exceptSessionId ? sql`${sessionsTable.id} <> ${exceptSessionId}` : sql`true`,
        ),
      )
      .returning({ id: sessionsTable.id });
    return rows.length;
  }

  /** Danh sách phiên đang mở của một user — màn SA quản trị phiên (story 1.4). */
  async listActive(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)));
    return rows;
  }

  /**
   * Dọn phiên đã chết — chặn bảng phình vô hạn. Chạy từ sweep (xem `onModuleInit`).
   *
   * Ngưỡng đọc từ `system_config` (AD-11, DoD gạch 8), không viết cứng 30: "giữ vết đăng nhập
   * bao lâu" là quyết định của bộ phận IT và sẽ được siết dần — siết bằng một câu UPDATE thì
   * không phải dựng lại ảnh docker.
   *
   * Cắt theo `last_seen_at`, không theo `expires_at`: một phiên hết hạn hôm qua nhưng vừa
   * được dùng thì vẫn là dữ kiện cho câu "ai đăng nhập từ máy nào" lúc điều tra sự cố.
   */
  async purgeOld(): Promise<number> {
    const days = await this.config.getNumber('sessionRetentionDays');
    const rows = await this.db
      .delete(sessionsTable)
      .where(lt(sessionsTable.lastSeenAt, sql`now() - make_interval(days => ${days})`))
      .returning({ id: sessionsTable.id });
    return rows.length;
  }
}
