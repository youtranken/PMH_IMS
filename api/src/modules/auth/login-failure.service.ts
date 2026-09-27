import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { registerFailure, type LockoutPolicy, type LockoutState } from '../../common/lockout';
import { SystemConfigService } from '../config-sys/system-config.service';
import { SweepService } from '../queue/sweep.service';
import { loginFailureTable } from './login-failure.schema';

/**
 * Khoá đăng nhập theo CẶP (người dùng, IP) — NFR-01, bản 11/09.
 *
 * Vì sao không còn khoá theo tài khoản: xem khối chú thích đầu
 * `0045_login_failure_per_ip.sql`. Tóm tắt — khoá theo tài khoản là một cái nút mà người lạ
 * bấm được, và người đáng bị khoá nhất là SA đúng lúc đang có sự cố.
 *
 * Luật (ngưỡng, "khoá hết hạn thì đếm lại từ 0", `justLocked`) KHÔNG viết lại ở đây: vẫn là
 * `common/lockout.ts`, vẫn được `lockout.spec.ts` chốt bằng test bảng dữ liệu. File này chỉ
 * đổi chỗ CẤT bộ đếm.
 */
@Injectable()
export class LoginFailureService implements OnModuleInit {
  private readonly logger = new Logger(LoginFailureService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: SystemConfigService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register({ name: 'login-failure-prune', run: () => this.pruneStale() });
  }

  /**
   * Khoá dùng cho bộ đếm. Không lấy được IP thì dùng `'unknown'` — ĐÚNG chuỗi mà
   * `LoginRateGuard` dùng, để hai hàng rào không chia thế giới theo hai cách khác nhau.
   *
   * Gộp mọi request không có IP vào một khoá là cố ý: nhánh đó chỉ xảy ra khi cấu hình proxy
   * hỏng, và lúc đó thà siết chặt hơn mức cần còn hơn để hở.
   */
  static keyFor(ip: string | null | undefined): string {
    return ip ?? 'unknown';
  }

  /**
   * Trạng thái khoá của cặp này. `login()` gọi hai lần: trước khi băm mật khẩu (bằng pool), và
   * lại trong transaction cấp phiên sau khi đã khoá hàng `users` (khe L8).
   */
  async stateFor(userId: string, ip: string | null, tx?: Tx): Promise<LockoutState> {
    const rows = await (tx ?? this.db)
      .select({
        failedAttempts: loginFailureTable.failedAttempts,
        lockedUntil: loginFailureTable.lockedUntil,
      })
      .from(loginFailureTable)
      .where(
        and(
          eq(loginFailureTable.userId, userId),
          eq(loginFailureTable.ip, LoginFailureService.keyFor(ip)),
        ),
      );
    return rows[0] ?? { failedAttempts: 0, lockedUntil: null };
  }

  /**
   * Cộng một lượt sai cho cặp này, TRONG transaction của lượt đăng nhập hỏng.
   *
   * `INSERT ... ON CONFLICT DO NOTHING` rồi mới `FOR UPDATE`: hàng có thể chưa tồn tại, mà
   * `FOR UPDATE` thì không khoá được thứ chưa có. Hai lượt song song cùng chèn thì lượt sau
   * dừng ở chỉ mục unique tới khi lượt trước commit, rồi mới đi tiếp — nên tới lúc đọc lại,
   * nó thấy giá trị đã commit chứ không phải ảnh chụp cũ.
   *
   * Đây đúng nước cờ `registerLoginFailureWithin` đang dùng trên hàng `users` (rà soát 08/09,
   * #5: N lượt đoán song song chỉ tốn 1 lượt đếm), chỉ thêm bước dựng hàng.
   */
  async registerFailureWithin(
    tx: Tx,
    userId: string,
    ip: string | null,
    policy: LockoutPolicy,
    now: Date,
  ): Promise<LockoutState & { justLocked: boolean }> {
    const key = LoginFailureService.keyFor(ip);
    await tx
      .insert(loginFailureTable)
      .values({ userId, ip: key, failedAttempts: 0, updatedAt: now })
      .onConflictDoNothing();

    const current = await tx
      .select({
        failedAttempts: loginFailureTable.failedAttempts,
        lockedUntil: loginFailureTable.lockedUntil,
      })
      .from(loginFailureTable)
      .where(and(eq(loginFailureTable.userId, userId), eq(loginFailureTable.ip, key)))
      .for('update');

    if (current.length === 0) {
      // Hồ sơ người dùng vừa bị xoá xen giữa (ON DELETE CASCADE). Không có gì để đếm.
      return { failedAttempts: 0, lockedUntil: null, justLocked: false };
    }

    const next = registerFailure(current[0], policy, now);
    await tx
      .update(loginFailureTable)
      .set({
        failedAttempts: next.failedAttempts,
        lockedUntil: next.lockedUntil,
        updatedAt: now,
      })
      .where(and(eq(loginFailureTable.userId, userId), eq(loginFailureTable.ip, key)));
    return next;
  }

  /**
   * Đăng nhập ĐÚNG từ nơi này → xoá dấu vết của CHÍNH nơi này.
   *
   * Cố ý không xoá hàng của IP khác: nếu có ai đang dò tài khoản này từ chỗ khác, khoá bên đó
   * phải còn nguyên. Người dùng thật đăng nhập được không phải là bằng chứng rằng kẻ kia đã
   * thôi gõ.
   */
  async clearFor(userId: string, ip: string | null, tx?: Tx): Promise<void> {
    await (tx ?? this.db)
      .delete(loginFailureTable)
      .where(
        and(
          eq(loginFailureTable.userId, userId),
          eq(loginFailureTable.ip, LoginFailureService.keyFor(ip)),
        ),
      );
  }

  /**
   * Dọn hàng đã nguội (AD-9, chạy trong sweep ~1 phút/lần).
   *
   * Mỗi cặp (người dùng, IP) từng gõ sai để lại một hàng, nên một lượt dò rải rác từ 100 nghìn
   * IP để lại 100 nghìn hàng. Không dọn thì bảng này là chỗ ai cũng ghi thêm được mà không ai
   * xoá.
   *
   * Cửa sổ derive từ `login.lockout_minutes` chứ không phải một con số mới trong
   * `system_config` (AD-11 dành cho tham số NGHIỆP VỤ, còn đây là dọn rác). Nhân 4 để hàng còn
   * sống sót qua vài lượt thử của người dùng thật đang loay hoay nhớ mật khẩu.
   *
   * Hai điều kiện, và điều kiện thứ hai mới là điều kiện an toàn: KHÔNG bao giờ xoá một hàng
   * đang khoá. Xoá nhầm nó là tự tay mở khoá cho người đang dò.
   */
  async pruneStale(): Promise<void> {
    const lockoutMinutes = await this.config.getNumber('loginLockoutMinutes');
    const staleMinutes = Math.max(60, lockoutMinutes * 4);
    const deleted = await this.db
      .delete(loginFailureTable)
      .where(
        and(
          lt(loginFailureTable.updatedAt, sql`now() - make_interval(mins => ${staleMinutes})`),
          or(
            isNull(loginFailureTable.lockedUntil),
            lt(loginFailureTable.lockedUntil, sql`now()`),
          ),
        ),
      )
      .returning({ ip: loginFailureTable.ip });
    if (deleted.length > 0) {
      this.logger.debug(`login-failure-prune: xoá ${deleted.length} hàng đã nguội`);
    }
  }
}
