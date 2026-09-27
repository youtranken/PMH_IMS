import { Injectable } from '@nestjs/common';
import type { Tx } from '../../common/tx';
import { ExpiryDigestService } from './expiry-digest.service';
import { ExpiryService, type ExpiryRow, type ExpirySummary } from './expiry.service';

/**
 * AD-2: public api DUY NHẤT của module `expiry`.
 * Dashboard sếp (Epic 7) và bộ gửi email digest (3.5) hỏi qua đây.
 */
@Injectable()
export class ExpiryApiService {
  constructor(
    private readonly expiry: ExpiryService,
    private readonly digest: ExpiryDigestService,
  ) {}

  /**
   * `withinDays` KHÔNG BẮT BUỘC, và bỏ trống là cách dùng đúng của hầu hết nơi gọi.
   *
   * Bỏ trống = "cửa sổ mặc định", và mặc định ấy là `expiry.warning_days` trong `system_config`
   * (AD-11) — module `expiry` là chủ của câu hỏi "sắp hết hạn nghĩa là trong bao nhiêu ngày".
   * Chỉ truyền số khi NGƯỜI DÙNG tự chọn một cửa sổ khác trên màn hình.
   *
   * Tham số này từng là bắt buộc, nên dashboard phải bịa ra một con số để mà truyền — và nó
   * bịa `30`, ghi đè cấu hình suốt từ Epic 7 (A-08, vá 21/09). Một tham số bắt buộc mà nơi
   * gọi không có gì để điền là một cái bẫy: người ta sẽ điền hằng số.
   */
  list(
    options: {
      withinDays?: number;
      kinds?: string[];
      /** Chỉ lấy `limit` dòng đầu — nơi gọi chỉ bày vài dòng thì đừng kéo cả kho về (N-01). */
      limit?: number;
    } = {},
  ): Promise<{ items: ExpiryRow[]; total: number; summary: ExpirySummary }> {
    return this.expiry.list(options);
  }

  /**
   * Nội dung email digest của một luật. Consumer mail gọi qua đây với `ruleId` lấy từ outbox
   * — outbox chỉ giữ id tham chiếu, không PII (AD-11/NFR-04).
   */
  buildDigest(ruleId: string) {
    return this.digest.buildDigest(ruleId);
  }

  /** Lịch sử gia hạn của một hồ sơ — trang chi tiết module chủ hiện được mà không cần bảng riêng. */
  historyFor(kind: string, id: string) {
    return this.expiry.historyFor(kind, id);
  }

  /**
   * Ghi một lượt gia hạn vào `renewal_history` NGAY TRONG transaction của module chủ (AC 3.4).
   *
   * Module chủ (`software`) gọi cửa này ở cuối `renew()` của mình. Nhờ vậy hai nút
   * "Gia hạn" trên web — nút ở màn "Sắp hết hạn" và nút trong chính trang hồ sơ — dẫn tới cùng
   * một hệ quả, thay vì cửa sau đổi `end_date` mà không để lại dòng nào (rà soát 07/09, #7).
   *
   * `tx` là bắt buộc, không có bản chạy trên pool: gia hạn xong mà sổ không ghi thì báo cáo
   * cuối năm thiếu một dòng vĩnh viễn — `renewal_history` chỉ-thêm.
   */
  recordRenewalWithin(
    tx: Tx,
    entry: {
      objectKind: string;
      objectId: string;
      label: string;
      oldEnd: string | null;
      newEnd: string;
      actor: string;
    },
  ): Promise<void> {
    return this.expiry.recordRenewalWithin(tx, entry);
  }
}
