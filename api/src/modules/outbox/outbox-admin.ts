import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { OutboxService } from './outbox.service';

/** Một thư chưa gửi được như màn "Thư gửi lỗi" thấy nó (Q-25) — không có payload của sự kiện. */
export interface FailedMailItem {
  id: string;
  topic: string;
  createdAt: Date;
  failCount: number;
  lastError: string | null;
  lastFailedAt: Date | null;
}

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

/**
 * Che phần trước `@` của mọi địa chỉ trong một chuỗi lỗi: lỗi SMTP hay chép nguyên địa chỉ người
 * nhận, mà màn này chỉ cần biết thư hỏng vì sao, không cần biết gửi cho ai.
 */
export function maskEmails(text: string): string {
  return text.replace(EMAIL, '$1***@$2');
}

/**
 * Việc của SA với thư gửi lỗi (Q-25): xem và gửi lại. Đọc/ghi bảng `outbox` qua `OutboxService`
 * (module này là chủ bảng, AD-3); gửi lại ghi nhật ký trong CÙNG transaction (AD-5).
 */
@Injectable()
export class OutboxAdminService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly audit: AuditWriterService,
  ) {}

  async listFailed(): Promise<{ total: number; items: FailedMailItem[] }> {
    const { total, items } = await this.outbox.listFailed();
    return { total, items: items.map((item) => ({ ...item, lastError: item.lastError === null ? null : maskEmails(item.lastError) })) };
  }

  async failedCount(): Promise<{ count: number }> {
    return { count: await this.outbox.countFailed() };
  }

  async requeue(id: string, actor: string): Promise<{ id: string }> {
    await this.db.transaction(async (tx) => {
      const done = await this.outbox.requeue(id, tx);
      if (!done) {
        throw new NotFoundException({ code: 'OUTBOX_NOT_PENDING', message: 'Thư này không còn để gửi lại (đã gửi xong hoặc đã dọn).' });
      }
      await this.audit.appendWithin(tx, { actor, action: 'outbox.requeued', objectType: 'outbox', objectId: id, detail: done });
    });
    return { id };
  }
}
