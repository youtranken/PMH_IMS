import { Injectable } from '@nestjs/common';
import { ExpiryService, type ExpiryRow, type ExpirySummary } from './expiry.service';

/**
 * AD-2: public api DUY NHẤT của module `expiry`.
 * Dashboard sếp (Epic 7) và bộ gửi email digest (3.5) hỏi qua đây.
 */
@Injectable()
export class ExpiryApiService {
  constructor(private readonly expiry: ExpiryService) {}

  list(
    withinDays: number,
    kinds?: string[],
  ): Promise<{ items: ExpiryRow[]; summary: ExpirySummary }> {
    return this.expiry.list({ withinDays, kinds });
  }

  /** Lịch sử gia hạn của một hồ sơ — trang chi tiết module chủ hiện được mà không cần bảng riêng. */
  historyFor(kind: string, id: string) {
    return this.expiry.historyFor(kind, id);
  }
}
