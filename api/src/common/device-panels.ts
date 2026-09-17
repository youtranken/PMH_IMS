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

/**
 * AI ĐANG HỎI — thêm 17/09/2026, và đây là một lỗ rò thật đã bịt chứ không phải dọn dẹp.
 *
 * `GET /devices/:id/panels` mở cho cả vai `member`, nhưng bản trước chỉ truyền `deviceId` cho
 * provider. Provider vì thế KHÔNG CÓ CÁCH NÀO kiểm quyền — hàng rào không bị quên ở một dòng,
 * nó không có chỗ để đứng. Hệ quả: khu "Két sắt" trả nhãn ngăn + tên đăng nhập của mọi secret
 * trên máy cho một Member mà ma trận quyền đã từ chối, trong khi `GET /vault/secrets` của
 * chính người đó trả 403. Cùng một dữ liệu, một cửa đóng, một cửa mở — và đường mở không ghi
 * một dòng audit nào.
 *
 * Khai `role` bằng `string` chứ không phải union `UserRole`: `common` không được phụ thuộc vào
 * module `auth` (AD-2). Provider nào cần thì tự so chuỗi.
 */
export interface PanelViewer {
  email: string;
  /** 'sa' | 'admin' | 'member'. */
  role: string;
}

export interface DevicePanelProvider {
  readonly panelKey: string;
  /**
   * Trả `null` = module này không có gì để nói về thiết bị đó (không hiện panel).
   * Trả panel có `items` rỗng = có liên quan nhưng đang trống (hiện `emptyText`).
   *
   * `viewer` là NGƯỜI ĐANG XEM, không phải chủ thiết bị. Provider nào bày dữ liệu có gác quyền
   * thì PHẢI tự hỏi quyền của người này — registry không hỏi hộ.
   */
  buildFor(deviceId: string, viewer: PanelViewer): Promise<DevicePanel | null>;
}

export const DEVICE_PANEL_PROVIDERS = 'DEVICE_PANEL_PROVIDERS';
