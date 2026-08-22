/**
 * AD-2 + AC story 2.5: trang chi tiết thiết bị có "khu mở rộng" — IP, license, secret,
 * phiếu ISO… — mà module `devices` KHÔNG được biết gì về các module đó.
 *
 * Cách làm: module chủ (ipam, software, vault, sheets) tự đăng ký một provider vào token
 * `DEVICE_PANEL_PROVIDERS`; devices chỉ gọi interface. Epic chưa mở thì danh sách provider
 * RỖNG và trang vẫn chạy, không lỗi, không có tab trống — "ẩn gọn khi chưa có".
 *
 * Ngược lại với cách hay gặp: devices import thẳng IpamService rồi bọc `if (module tồn tại)`.
 * Kiểu đó phá đồ thị phụ thuộc và mỗi epic mới lại phải sửa vào devices.
 */

export interface DevicePanelItem {
  label: string;
  value: string;
  /** Đường dẫn UI để bấm sang hồ sơ gốc (vd `/dia-chi-ip/abc`). */
  link?: string;
  /** Tông màu badge nếu giá trị là trạng thái: 'ok' | 'warn' | 'danger' | 'muted'. */
  tone?: 'ok' | 'warn' | 'danger' | 'muted';
}

export interface DevicePanel {
  /** Khóa ổn định, dùng làm key React và để test bám vào: 'ipam', 'vault', 'software'… */
  key: string;
  title: string;
  items: DevicePanelItem[];
  /** Câu hiện khi module có mặt nhưng thiết bị này chưa có dữ liệu. */
  emptyText?: string;
}

export interface DevicePanelProvider {
  readonly panelKey: string;
  /**
   * Trả `null` = module này không có gì để nói về thiết bị đó (không hiện panel).
   * Trả panel có `items` rỗng = có liên quan nhưng đang trống (hiện `emptyText`).
   */
  buildFor(deviceId: string): Promise<DevicePanel | null>;
}

export const DEVICE_PANEL_PROVIDERS = 'DEVICE_PANEL_PROVIDERS';
