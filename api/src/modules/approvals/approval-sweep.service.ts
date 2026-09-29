import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { overdueSince } from '../../common/approvals/approval-flow';
import { SystemConfigService } from '../config-sys/system-config.service';
import { OutboxService } from '../outbox/outbox.service';
import { SweepService } from '../queue/sweep.service';
import { ApprovalsService } from './approvals.service';
import { redactMessage } from '../../common/log-redact';

/** Đã nhắc rồi thì thôi — cờ nằm trong `payload`, không cần thêm cột. */
const REMINDED_KEY = 'remindedAt';

/**
 * Sweep của module duyệt (AD-6): dọn grant hết hạn + nhắc yêu cầu treo lâu.
 *
 * Hai việc, và chỉ MỘT trong hai là quan trọng về mặt an ninh:
 *  - Dọn grant hết hạn chỉ là VỆ SINH. Quyền đã bị cắt từ khoảnh khắc `expires_at` trôi qua vì
 *    mọi đường đọc gọi `isGrantActive`. Sweep này chết thì danh sách hiển thị hơi bẩn, chứ
 *    không ai xem lén được gì (AD-6).
 *  - Nhắc yêu cầu treo thì ngược lại: không có nó, một yêu cầu break-glass lúc 2 giờ sáng nằm
 *    im tới sáng và người trực ngồi chờ một người duyệt không hề biết có việc.
 */
@Injectable()
export class ApprovalSweepService implements OnModuleInit {
  private readonly logger = new Logger(ApprovalSweepService.name);

  constructor(
    private readonly approvals: ApprovalsService,
    private readonly outbox: OutboxService,
    private readonly config: SystemConfigService,
    private readonly sweep: SweepService,
  ) {}

  onModuleInit(): void {
    this.sweep.register({ name: 'approval-expire', run: () => this.expireDue() });
    this.sweep.register({ name: 'approval-remind', run: () => this.remindOverdue() });
  }

  private async expireDue(): Promise<void> {
    const closed = await this.approvals.expireDueGrants();
    if (closed > 0) this.logger.log(`đóng ${closed} grant hết hạn`);
  }

  /**
   * Nhắc MỘT LẦN cho mỗi yêu cầu.
   *
   * Sweep chạy mỗi phút; không có cờ thì một yêu cầu bị bỏ quên đẻ ra một email mỗi phút — và
   * cách nhanh nhất để người duyệt lọc hết thư của hệ thống vào thùng rác là gửi cho họ 60
   * email một giờ về cùng một việc.
   */
  private async remindOverdue(): Promise<void> {
    const hours = await this.config.getNumber('approvalReminderHours');
    // 0 = admin tắt nhắc. `overdueSince` cũng chặn, nhưng thoát sớm ở đây thì khỏi quét DB.
    if (hours <= 0) return;

    const pending = await this.approvals.pending();
    const now = new Date();

    for (const request of pending) {
      // Từng yêu cầu một try/catch: một cái hỏng không được làm câm mọi cái xếp sau.
      try {
        if (!overdueSince(request.createdAt, hours, now)) continue;
        if (request.payload?.[REMINDED_KEY]) continue;

        await this.approvals.runInTransaction(async (tx) => {
          // Chốt lượt nhắc TRƯỚC, và chỉ gửi nếu chốt được: hai worker cùng chạy thì chỉ một
          // người thắng, người duyệt không lãnh hai email giống hệt nhau.
          const claimed = await this.approvals.claimReminderWithin(tx, request.id, now);
          if (!claimed) return;
          // Cùng transaction với việc chốt (AD-5): rollback là mất cả hai, không có chuyện
          // đã đánh dấu "đã nhắc" mà email thì không bao giờ đi.
          // Outbox chỉ mang ID tham chiếu, KHÔNG PII (AD-11/NFR-04) — consumer tự đọc lại.
          await this.outbox.enqueueWithin(tx, 'approval.reminder', { approvalId: request.id });
        });
      } catch (error) {
        this.logger.warn(
          `nhắc yêu cầu ${request.id} lỗi: ${redactMessage(error)}`,
        );
      }
    }
  }
}
