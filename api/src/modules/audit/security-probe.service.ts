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
 * Ba tham số đều nằm ở `system_config` (AD-11), không hardcode.
 */

/** Những hành động tính là "dò dẫm". Thêm loại mới thì thêm vào đây, đừng đếm ở nơi gọi. */
const PROBE_ACTIONS = ['vault.secret.reveal_denied', 'auth.stepup.failed'];

/** Dòng ghi lại "đã cảnh báo cho người này rồi" — chính nó là bộ nhớ của thời gian nghỉ. */
const ALERTED_ACTION = 'security.probe.alerted';

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

      /*
       * MỘT transaction cho CẢ BA việc: khoá người → đọc thời gian nghỉ → ghi vết + thư.
       *
       * ===== VÌ SAO PHÉP KIỂM PHẢI NẰM TRONG ĐÂY (18/09/2026) =====
       *
       * Bản trước đọc "đã cảnh báo chưa" bằng `this.db` ở NGOÀI, rồi mới mở transaction để
       * ghi. Giữa hai bước đó không có gì giữ chỗ, nên nhiều lượt song song cùng đọc ra số 0
       * rồi cùng ghi — đúng thứ thời gian nghỉ sinh ra để chặn.
       *
       * Không phải lỗ hẹp: trần của cửa mở ngăn là 30 lượt mỗi phút cho mỗi người
       * (`@Throttle` ở `vault.controller.ts`), và một Member không có quyền gì trên két vẫn
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
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${actor}))`);

        const quietSince = new Date(Date.now() - cooldownMinutes * 60_000);
        const [alerted] = await tx
          .select({ n: count() })
          .from(auditLogTable)
          .where(
            and(
              eq(auditLogTable.actor, actor),
              eq(auditLogTable.action, ALERTED_ACTION),
              gt(auditLogTable.createdAt, quietSince),
            ),
          );
        if ((alerted?.n ?? 0) > 0) return;

        /*
         * Vết và thư đi CÙNG một transaction (AD-5). Rời ra thì hoặc thư đi mà không có vết
         * (lần sau lại gửi tiếp, vì thời gian nghỉ đọc từ chính cái vết ấy), hoặc có vết mà
         * thư không đi — và không ai biết là đã có cảnh báo bị nuốt.
         *
         * `appendWithin` chứ không phải `tx.insert` tay: chỉ đường kia mới đi qua `toRow()`,
         * nơi cột `ip` được lấy từ `currentRequestIp()`. Insert thẳng thì `ip` LUÔN NULL —
         * đúng khoảng trống NFR-03 mà rà soát 07/09 vừa vá ("cột này có trong
         * `0004_audit_log.sql` từ ngày đầu nhưng THIẾU ở bảng drizzle suốt 9 epic"), nay tái
         * xuất ở dòng an ninh đáng giá nhất. `noteFailure` chạy trong ngữ cảnh request nên
         * `currentRequestIp()` CÓ giá trị, và "dò từ máy nào" là câu điều tra viên hỏi đầu tiên.
         */
        await this.audit.appendWithin(tx, {
          actor,
          action: ALERTED_ACTION,
          objectType: 'session',
          /* `undefined`, không phải `null`: `AuditEntry.objectId` khai `string | undefined`.
             Dòng này nói về một PHIÊN dò dẫm, không về một ngăn cụ thể. */
          objectId: undefined,
          detail: { count: recent?.n ?? 0, windowMinutes },
        });
        /* `cooldownMinutes` đi kèm để lá thư nói đúng thời gian nghỉ THẬT thay vì viết cứng
           "một giờ" — xem chú thích ở `mail.consumer.ts`. `who` là email chứ không phải id:
           ngoại lệ có tên, khai ở `outbox.service.ts` cạnh chính luật "payload không PII". */
        await this.outbox.enqueueWithin(tx, 'security.probe.alert', {
          who: actor,
          count: recent?.n ?? 0,
          windowMinutes,
          cooldownMinutes,
        });
      });
    } catch (error) {
      /*
       * Nuốt có chủ ý — xem chú thích ở đầu hàm — NHƯNG PHẢI KÊU LÊN (18/09/2026).
       *
       * Bản trước là `catch {}` rỗng, không một chữ nào. Nghĩa là nếu `db.transaction` hỏng,
       * `outbox.enqueueWithin` hỏng, hay `config.getNumber` ném (bảng `system_config` lỗi) thì
       * hàng rào PHÁT HIỆN chết vĩnh viễn: không thư, không dòng `security.probe.alerted`,
       * không log — và không cách nào biết ngoài việc ngồi chờ một cuộc tấn công thật rồi thấy
       * hộp thư im lặng.
       *
       * Lý do cũ ("thông điệp lỗi có thể mang tên người và id ngăn") không đứng vững: repo đã
       * có sẵn `redactMessage` dùng đúng cho việc này ở `DevicePanelRegistry` và
       * `AuditWriterService`. Vẫn không ném, vẫn không lộ gì.
       */
      this.logger.error(`Canh dò két hỏng, KHÔNG có cảnh báo nào đi: ${redactMessage(error)}`);
    }
  }

  /** Dùng cho bài kiểm và cho màn nhật ký: những hành động được tính là dò dẫm. */
  static get probeActions(): readonly string[] {
    return PROBE_ACTIONS;
  }
}
