import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { SystemConfigService } from '../config-sys/system-config.service';
import { OutboxService } from '../outbox/outbox.service';
import { auditLogTable } from './audit.schema';
import { AuditWriterService } from './audit-writer.service';
import { redactMessage } from '../../common/log-redact';

/**
 * Canh người đang DÒ DẪM quanh két, và báo cho quản trị khi đủ đáng ngờ.
 *
 * ===== VÌ SAO Ở MODULE `audit` =====
 *
 * Câu hỏi "người này vừa sinh ra bao nhiêu dòng đáng ngờ" là câu hỏi về CHÍNH bảng `audit_log`,
 * mà module này là chủ bảng đó (AD-3). Hai nơi cần nó — `vault` (bị từ chối mở ngăn) và `auth`
 * (gõ sai mã 6 số) — đều đã phụ thuộc vào `AuditWriterService`, nên không sinh thêm cạnh mới
 * nào trong đồ thị. Đặt ở `vault` thì `auth` phải gọi ngược vào `vault` (vốn đang phụ thuộc
 * `auth` qua guard) — thành vòng.
 *
 * ===== HAI LOẠI TÍN HIỆU, MỘT NGƯỠNG =====
 *
 * Đếm CHUNG cả hai, theo cùng một người:
 *   · `vault.secret.reveal_denied` — thử mở một ngăn mà ma trận quyền từ chối;
 *   · `auth.stepup.failed` — gõ sai mã 6 số ở cửa mở két.
 * Tách hai bộ đếm thì một kẻ khôn ngoan chỉ cần xen kẽ hai kiểu là không chạm ngưỡng nào cả.
 *
 * ===== VÌ SAO CÓ THỜI GIAN NGHỈ =====
 *
 * Không có `cooldown` thì chính cái cảnh báo trở thành công cụ tấn công: bắn liên tục vài trăm
 * lượt là hộp thư của mọi quản trị viên ngập, và thư thật chìm nghỉm trong đó. Một lần cảnh báo
 * cho mỗi đợt là đủ để người ta vào xem nhật ký — nơi có đầy đủ chi tiết.
 *
 * ===== VÌ SAO VẪN CÓ MỘT LÁ LEO THANG TRONG LÚC NGHỈ (OLD-SEC-01) =====
 *
 * Nghỉ tuyệt đối thì lá đầu nói "3 lượt" và kẻ dò bắn thêm hàng trăm lượt trong im lặng — người
 * đọc thư tưởng là gõ nhầm. Vượt `hệ số × ngưỡng` trong lúc nghỉ thì đi thêm đúng MỘT lá, đánh
 * dấu `escalated`. Mỗi thời gian nghỉ tối đa một lá leo thang, nên hộp thư vẫn không ngập.
 *
 * Bốn tham số đều nằm ở `system_config` (AD-11), không hardcode.
 */

/** Những hành động tính là "dò dẫm". Thêm loại mới thì thêm vào đây, đừng đếm ở nơi gọi. */
const PROBE_ACTIONS = [
  'vault.secret.reveal_denied',
  'auth.stepup.failed',
  /*
   * Đoán mật khẩu ở cửa GẮN yếu tố thứ hai (A-02). Cùng một người, cùng một mục tiêu:
   * cửa này dẫn thẳng tới step-up, và step-up dẫn thẳng vào két. Không đếm nó thì kẻ cầm
   * cookie trộm được có 10 lần đoán mỗi phút mà không sinh ra một lời cảnh báo nào — trong
   * khi chính nó là dấu hiệu rõ nhất rằng có một cookie đang ở nhầm tay.
   */
  'auth.totp.enroll.reauth_failed',
  // Sai mã TOTP lúc đăng nhập: người này đã có mật khẩu, chỉ còn thiếu điện thoại (SEC-02).
  'auth.totp.failed',
  // Đoán mật khẩu hiện tại ở cửa Đổi mật khẩu bằng một cookie đang mở (SEC-06).
  'auth.password.change_failed',
];

/** Dòng ghi lại "đã cảnh báo cho người này rồi" — chính nó là bộ nhớ của thời gian nghỉ. */
const ALERTED_ACTION = 'security.probe.alerted';

/**
 * Mã LỚP cho khoá advisory dạng hai tham số — xem chú thích tại chỗ khoá.
 *
 * Dạng `(int, int)` là một không gian khoá RIÊNG, không đụng `pg_advisory_lock(727001)` mà
 * `database/migration-runner.ts` (`MIGRATION_LOCK_ID`) giữ ở mức phiên. Thêm khoá advisory mới
 * ở đâu thì cấp cho nó một mã lớp khác và ghi cạnh đây.
 *
 * Đã cấp: 42_002 — một cổng port map (`devices/device-ports.service.ts`, `PORT_LOCK_CLASS`).
 */
const PROBE_LOCK_CLASS = 42_001;

@Injectable()
export class SecurityProbeService {
  private readonly logger = new Logger(SecurityProbeService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: SystemConfigService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditWriterService,
  ) {}

  /**
   * Gọi NGAY SAU khi đã ghi dòng audit của lượt thất bại (không phải thay cho nó).
   *
   * Cố ý không ném ra ngoài: đây là tầng cảnh báo, không phải tầng chặn. Hàng rào thật đã làm
   * xong việc của nó (403 đã trả, phiên đã bị thu hồi) — nếu gửi thư hỏng mà kéo theo cả lượt
   * từ chối hỏng thì hàng rào tự bắn vào chân mình.
   */
  async noteFailure(actor: string): Promise<void> {
    try {
      const windowMinutes = await this.config.getNumber('secretProbeWindowMinutes');
      const threshold = await this.config.getNumber('secretProbeAlertThreshold');
      if (threshold <= 0) return;
      /*
       * BA THAM SỐ, BA CÁCH HỎNG KHÁC NHAU KHI BẰNG 0.
       *
       * `threshold <= 0` là công tắc TẮT có chủ ý — mô tả của khoá trong `system_config` nói đúng như vậy.
       * Hai cái còn lại thì không, và hỏng ngược nhau:
       *   · `windowMinutes <= 0` → `since` = hiện tại → `recent` luôn 0 → hàng rào tắt TRONG IM
       *     LẶNG, trông y hệt "chưa ai dò". Nguy hiểm hơn hẳn công tắc tắt tường minh.
       *   · `cooldownMinutes <= 0` → `quietSince` = hiện tại → không lá thư nào tính là "vừa
       *     gửi" → mỗi lượt thất bại một lá, đúng nạn ngập hộp thư mà thời gian nghỉ sinh ra để
       *     chặn.
       * Cả hai đều là cấu hình VÔ NGHĨA, không phải ý định — nên dừng và kêu, đừng đoán hộ.
       */
      if (windowMinutes <= 0) {
        this.logger.error(
          `secretProbeWindowMinutes = ${windowMinutes} (phải > 0) — bỏ qua lượt canh dò dẫm`,
        );
        return;
      }

      const since = new Date(Date.now() - windowMinutes * 60_000);
      const [recent] = await this.db
        .select({ n: count() })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.actor, actor),
            inArray(auditLogTable.action, PROBE_ACTIONS),
            gt(auditLogTable.createdAt, since),
          ),
        );
      if ((recent?.n ?? 0) < threshold) return;

      const cooldownMinutes = await this.config.getNumber('secretProbeCooldownMinutes');
      if (cooldownMinutes <= 0) {
        this.logger.error(
          `secretProbeCooldownMinutes = ${cooldownMinutes} (phải > 0) — bỏ qua để khỏi làm ngập hộp thư`,
        );
        return;
      }

      /*
       * MỘT transaction cho CẢ BA việc: khoá người → đọc thời gian nghỉ → ghi vết + thư.
       *
       * ===== VÌ SAO PHÉP KIỂM PHẢI NẰM TRONG ĐÂY =====
       *
       * Đọc "đã cảnh báo chưa" bằng `this.db` ở NGOÀI rồi mới mở transaction để ghi thì giữa
       * hai bước đó không có gì giữ chỗ, nên nhiều lượt song song cùng đọc ra số 0 rồi cùng
       * ghi — đúng thứ thời gian nghỉ sinh ra để chặn.
       *
       * Không phải lỗ hẹp: trần của cửa mở ngăn là 30 lượt mỗi phút cho mỗi người
       * (`rate.secret_reveal_per_minute`, `@ConfigThrottle` ở `vault.controller.ts`), và một Member không có quyền gì trên két vẫn
       * bắn được đủ 30 lượt ấy song song. Cả 30 lượt đều 403, cả 30 đều gọi vào đây, cả 30
       * đều đọc thấy "chưa cảnh báo" → 30 lá thư tới MỌI SA và Admin trong một nhịp, rồi lặp
       * lại sau mỗi 60 phút. Tức là chính cái cảnh báo trở thành công cụ làm ngập hộp thư —
       * đúng câu mà chú thích "VÌ SAO CÓ THỜI GIAN NGHỈ" ở đầu file tuyên bố đã chặn được.
       *
       * `pg_advisory_xact_lock` xếp hàng theo TỪNG NGƯỜI, và tự nhả khi transaction kết thúc
       * (kể cả khi rollback) — không có đường nào quên mở khoá. Hai người khác nhau vẫn chạy
       * song song bình thường vì khoá băm từ chính `actor`.
       *
       * `hashtext` cho khoá 32 bit nên hai email khác nhau có thể đụng nhau; hậu quả tệ nhất
       * của một lượt đụng là hai người đó phải xếp hàng sau nhau trong vài mili giây, không
       * ai mất cảnh báo. Đánh đổi rẻ hơn hẳn một bảng khoá riêng.
       */
      await this.db.transaction(async (tx) => {
        /*
         * TRẦN CHỜ KHOÁ. `pg_advisory_xact_lock` là khoá CHỜ, và lượt chờ ấy giữ
         * một connection của pool trong lúc `vault.controller` đang `await` nó TRƯỚC khi ném
         * 403 về cho người dùng. Mặc định: `lock_timeout`, `statement_timeout` và
         * `idle_in_transaction_session_timeout` của DB đều là 0, `new Pool({connectionString})`
         * không khai `max` (mặc định pg = 10) cũng không khai `connectionTimeoutMillis`. Một
         * phiên kẹt `idle in transaction` khi đang giữ cùng khoá là mọi lượt sau chờ MÃI MÃI,
         * mỗi lượt ăn một trong 10 connection — cạn 10 là toàn bộ API đứng, không riêng đường
         * két, và không có gì tự gỡ. Hết 2 giây thì lệnh ném, `catch` bên ngoài đã ghi log sẵn,
         * và thứ mất đi chỉ là một lá thư cảnh báo trùng.
         */
        await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
        /*
         * DẠNG HAI THAM SỐ, ĐỂ TÁCH HẲN KHÔNG GIAN KHOÁ.
         *
         * `pg_advisory_xact_lock(bigint)` và `pg_advisory_xact_lock(int, int)` là HAI không gian
         * khoá riêng của Postgres. Dạng một tham số nằm chung không gian với
         * `pg_advisory_lock(727001)` mà `database/migration-runner.ts:51` giữ ở MỨC PHIÊN suốt
         * cả lượt migration. Một email băm ra đúng 727001 sẽ xếp hàng sau lượt migration ấy —
         * xác suất ~1/4,3 tỉ, nhưng hậu quả là vĩnh viễn với đúng người đó. Dạng hai tham số với
         * một mã lớp riêng thì hai không gian không bao giờ gặp nhau, và không tốn gì.
         */
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${PROBE_LOCK_CLASS}, hashtext(${actor}))`);

        /*
         * ĐẾM LẠI SAU KHI ĐÃ CÓ KHOÁ.
         *
         * `recent` ở trên được đọc TRƯỚC khi xếp hàng, chỉ để quyết định có mở transaction hay
         * không — nó là phép sàng lọc rẻ, không phải con số để ghi. Đem chính nó đi ghi vào
         * `audit_log.detail` và `outbox.payload` thì 30 lượt dò cùng một nhịp đều đọc ra 3 và
         * lượt thắng khoá ghi `{"count": 3}` (đo trên DB dev: **50/50** hàng
         * `security.probe.alert` đều mang đúng `"count": 3`). Điều tra viên nhận một con số thấp
         * hơn sự thật cả một bậc độ lớn, ở đúng dòng cảnh báo an ninh.
         */
        const [counted] = await tx
          .select({ n: count() })
          .from(auditLogTable)
          .where(
            and(
              eq(auditLogTable.actor, actor),
              inArray(auditLogTable.action, PROBE_ACTIONS),
              gt(auditLogTable.createdAt, since),
            ),
          );
        const attemptCount = counted?.n ?? recent?.n ?? 0;

        const quietSince = new Date(Date.now() - cooldownMinutes * 60_000);
        /* Lá thường và lá leo thang cùng một mã hành động (bộ lọc "sự kiện an ninh" và màn Nhật
           ký không phải biết thêm mã mới), phân biệt bằng `detail.escalated`. */
        const escalatedFlag = sql`${auditLogTable.detail}->>'escalated'`;
        const [alerted] = await tx
          .select({
            normal: sql<number>`count(*) FILTER (WHERE ${escalatedFlag} IS DISTINCT FROM 'true')`.mapWith(Number),
            escalated: sql<number>`count(*) FILTER (WHERE ${escalatedFlag} = 'true')`.mapWith(Number),
          })
          .from(auditLogTable)
          .where(
            and(
              eq(auditLogTable.actor, actor),
              eq(auditLogTable.action, ALERTED_ACTION),
              gt(auditLogTable.createdAt, quietSince),
            ),
          );
        let escalated = false;
        if ((alerted?.normal ?? 0) > 0) {
          if ((alerted?.escalated ?? 0) > 0) return;
          const multiplier = await this.config.getNumber('secretProbeEscalationMultiplier');
          // Hệ số < 2 thì lá "leo thang" đi ngay lượt kế tiếp — tức là tắt thời gian nghỉ.
          if (multiplier < 2) {
            this.logger.error(
              `secretProbeEscalationMultiplier = ${multiplier} (phải >= 2) — bỏ qua lá leo thang`,
            );
            return;
          }
          if (attemptCount < multiplier * threshold) return;
          escalated = true;
        }

        /*
         * Vết và thư đi CÙNG một transaction (AD-5). Rời ra thì hoặc thư đi mà không có vết
         * (lần sau lại gửi tiếp, vì thời gian nghỉ đọc từ chính cái vết ấy), hoặc có vết mà
         * thư không đi — và không ai biết là đã có cảnh báo bị nuốt.
         *
         * `appendWithin` chứ không phải `tx.insert` tay: chỉ đường kia mới đi qua `toRow()`,
         * nơi cột `ip` được lấy từ `currentRequestIp()`. Insert thẳng thì `ip` LUÔN NULL —
         * khoảng trống NFR-03, ở đúng dòng an ninh đáng giá nhất. `noteFailure` chạy trong ngữ
         * cảnh request nên `currentRequestIp()` CÓ giá trị, và "dò từ máy nào" là câu điều tra
         * viên hỏi đầu tiên.
         */
        await this.audit.appendWithin(tx, {
          actor,
          action: ALERTED_ACTION,
          objectType: 'session',
          /* `undefined`, không phải `null`: `AuditEntry.objectId` khai `string | undefined`.
             Dòng này nói về một PHIÊN dò dẫm, không về một ngăn cụ thể. */
          objectId: undefined,
          detail: { count: attemptCount, windowMinutes, ...(escalated ? { escalated: true } : {}) },
        });
        /* `cooldownMinutes` đi kèm để lá thư nói đúng thời gian nghỉ THẬT thay vì viết cứng
           "một giờ" — xem chú thích ở `mail.consumer.ts`. `who` là email chứ không phải id:
           ngoại lệ có tên, khai ở `outbox.service.ts` cạnh chính luật "payload không PII". */
        await this.outbox.enqueueWithin(tx, 'security.probe.alert', {
          who: actor,
          count: attemptCount,
          windowMinutes,
          cooldownMinutes,
          ...(escalated ? { escalated: true } : {}),
        });
      });
    } catch (error) {
      /*
       * Nuốt có chủ ý — xem chú thích ở đầu hàm — NHƯNG PHẢI KÊU LÊN.
       *
       * Một `catch {}` rỗng nghĩa là nếu `db.transaction` hỏng, `outbox.enqueueWithin` hỏng,
       * hay `config.getNumber` ném (bảng `system_config` lỗi) thì hàng rào PHÁT HIỆN chết vĩnh
       * viễn: không thư, không dòng `security.probe.alerted`, không log — và không cách nào biết
       * ngoài việc ngồi chờ một cuộc tấn công thật rồi thấy hộp thư im lặng.
       *
       * Sợ "thông điệp lỗi có thể mang tên người và id ngăn" không phải lý do để im: dùng
       * `redactMessage` như `DevicePanelRegistry` và `AuditWriterService`. Vẫn không ném, vẫn
       * không lộ gì.
       */
      this.logger.error(`Canh dò két hỏng, KHÔNG có cảnh báo nào đi: ${redactMessage(error)}`);
    }
  }

  /** Dùng cho bài kiểm và cho màn nhật ký: những hành động được tính là dò dẫm. */
  static get probeActions(): readonly string[] {
    return PROBE_ACTIONS;
  }
}
