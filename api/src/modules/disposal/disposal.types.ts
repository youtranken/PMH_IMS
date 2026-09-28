export const DISPOSAL_KINDS = ['device', 'software', 'service_account', 'isp'] as const;
export type DisposalKind = (typeof DISPOSAL_KINDS)[number];

export interface DisposalItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  /**
   * Nhãn phụ: loại thiết bị, loại phần mềm, loại tài khoản, băng thông đường truyền — thứ giúp
   * nhận ra nó là cái gì.
   */
  detail: string | null;
  /** Trạng thái THẬT trong module chủ, giữ nguyên tên gốc để tra ngược không nhầm. */
  status: string;
  updatedAt: Date | null;
  /**
   * Ngày vào kho: lần chuyển sang trạng thái ngừng dùng GẦN NHẤT trong lịch sử của module chủ.
   * Hồ sơ nhập thẳng ở trạng thái đó (không có dòng lịch sử) lùi về `updatedAt` — thà một mốc
   * gần đúng còn hơn bỏ trống cả cột.
   */
  disposedAt: Date | null;
  /** Email người làm, `system` khi lượt quét tự thanh lý (Q-13); `null` = lịch sử không ghi. */
  disposedBy: string | null;
  disposedByName: string | null;
  auto: boolean;
  /** Lý do đã ghi lúc đưa vào kho (tài khoản dịch vụ bắt ghi), nếu có. */
  reason: string | null;
}
