/** Vòng đời thiết bị (FR-001). Không có "đã xóa": sổ tài sản chỉ chuyển trạng thái. */
export const DEVICE_STATUSES = ['in_use', 'spare', 'broken', 'retired'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export interface DeviceRecord {
  id: string;
  code: string;
  name: string;
  deviceTypeId: string;
  model: string | null;
  serial: string | null;
  siteId: string | null;
  cabinetId: string | null;
  vendorId: string | null;
  assignedTo: string | null;
  department: string | null;
  purchaseDate: string | null;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  status: DeviceStatus;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bản ghi kèm nhãn danh mục đã tra sẵn — bảng danh sách và file export cần TÊN, không cần id.
 * Tra ở tầng service (một lần cho cả trang) thay vì để UI gọi thêm 4 lượt API.
 */
export interface DeviceListItem extends DeviceRecord {
  deviceTypeName: string;
  hasPortMap: boolean;
  siteCode: string | null;
  cabinetCode: string | null;
  vendorName: string | null;
}

export interface DeviceHistoryRecord {
  id: string;
  deviceId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DeviceFilter {
  search?: string;
  siteId?: string;
  cabinetId?: string;
  deviceTypeId?: string;
  status?: DeviceStatus;
  /** Khớp ĐÚNG phòng ban / người sử dụng (gấp dấu, hoa thường) — chọn nhanh cả lô máy. */
  department?: string;
  assignedTo?: string;
  /**
   * Chỉ máy CÒN NHẬN THÊM ĐƯỢC — dùng cho các ô chọn thiết bị, không dùng cho màn danh sách.
   *
   * Màn Thiết bị vẫn phải liệt kê máy đã thanh lý (đó là sổ). Nhưng ô chọn ở form NAT / cấp IP
   * / gán license / nối cổng / cắm đường truyền thì không: API đã chặn ghi vào máy `retired`
   * (`assertUsable`), nên bày chúng ra chỉ để người dùng chọn xong rồi ăn lỗi.
   */
  usableOnly?: boolean;
}

/**
 * Kết quả ghi kèm CẢNH BÁO (không phải lỗi): serial trùng thiết bị khác thì vẫn lưu nhưng
 * phải nói cho người dùng biết — thực tế có bộ nhập trùng do dán nhầm tem, chặn cứng là
 * người ta bịa serial giả để lưu cho xong.
 */
export interface DeviceWriteResult {
  device: DeviceRecord;
  warnings: string[];
}
