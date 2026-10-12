import type { LicenseModel, SoftwareKind, SoftwareStatus } from './software-rules';

export interface SoftwareRecord {
  id: string;
  code: string;
  name: string;
  kind: SoftwareKind;
  licenseModel: LicenseModel;
  vendorId: string | null;
  seatTotal: number | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  status: SoftwareStatus;
  createdAt: Date;
  updatedAt: Date;
  /** Website dùng chứng chỉ SSL / tên miền này; rỗng với loại khác (Q-15). */
  websites: string[];
  /** Số hợp đồng / PO chung của mọi ghế (Q-27). */
  contract: string | null;
  /** Mỗi ghế có hợp đồng, ghi chú, giấy tờ riêng (Q-27). */
  perSeat: boolean;
}

/** Một ghế của hồ sơ bật ghế riêng — kèm máy đang giữ (nếu có). */
export interface SoftwareSeatView {
  id: string;
  seatNo: number;
  contract: string | null;
  note: string | null;
  /** Lần gán đang chiếm ghế; null = ghế trống. */
  assignmentId: string | null;
  deviceId: string | null;
}

/** Bản ghi kèm thứ màn hình cần mà không phải gọi thêm API. */
export interface SoftwareListItem extends SoftwareRecord {
  vendorName: string | null;
  /** Đã gán bao nhiêu seat (FR-011). Loại không có seat thì luôn 0. */
  seatUsed: number;
}

/** Dòng trả cho màn hình (danh sách + chi tiết) — kèm mốc tự thanh lý (Q-13). */
export interface SoftwareScreenItem extends SoftwareListItem {
  /**
   * Ngày lượt quét sẽ tự Thanh lý hồ sơ Hết hạn; `null` khi không Hết hạn hoặc tự thanh lý
   * đang tắt. Server tính từ `software.auto_retire_grace_days` để màn không giả định 30 (AD-11).
   */
  autoRetireOn: string | null;
}

/** Hồ sơ Thanh lý lúc nào và do ai — băng đầu trang chi tiết đọc cái này. */
export interface SoftwareRetirement {
  at: Date;
  /** Email người thanh lý, hoặc `system` khi lượt quét tự thanh lý. */
  by: string;
  auto: boolean;
}

export interface SoftwareDetailItem extends SoftwareScreenItem {
  /** Chỉ có khi đang Thanh lý và lịch sử còn dòng chuyển sang Thanh lý. */
  retirement: SoftwareRetirement | null;
  /** Ghế riêng theo thứ tự (Q-27); rỗng khi hồ sơ không bật `perSeat`. */
  seats: SoftwareSeatView[];
}

export interface SoftwareHistoryRecord {
  id: string;
  softwareId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: Date;
}

export interface SoftwareFilter {
  search?: string;
  /**
   * Hồ sơ có ghế trên máy khớp ô tìm (`LicenseAssignmentService.softwareIdsOnDevices`). Ghép
   * bằng OR với phép khớp mã/tên: "máy X đang dùng license nào" hỏi bằng chính ô tìm.
   */
  alsoIds?: string[];
  /** Một màn = một hoặc vài loại (Q-22); vắng = mọi loại. */
  kinds?: SoftwareKind[];
  licenseModel?: LicenseModel;
  /** `live` = Đang dùng + Hết hạn — hai trạng thái còn trên máy, mặc định của màn danh sách. */
  status?: SoftwareStatus | 'live';
  vendorId?: string;
}
