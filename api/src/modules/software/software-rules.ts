/**
 * Luật hồ sơ phần mềm — hàm THUẦN, không chạm DB.
 *
 * Mỗi loại có bộ trường bắt buộc khác nhau: license phải có ngày hết hạn và số seat,
 * SSL/domain phải có ngày hết hạn, hợp đồng bảo trì thì ngày hết hạn là tùy. Nhét mấy
 * cái `if kind === …` này vào service là mỗi lần thêm loại lại phải dò khắp file.
 */

export const SOFTWARE_KINDS = ['license', 'ssl', 'domain', 'maintenance', 'other'] as const;
export type SoftwareKind = (typeof SOFTWARE_KINDS)[number];

export const SOFTWARE_STATUSES = ['active', 'expired_ok', 'retired'] as const;
export type SoftwareStatus = (typeof SOFTWARE_STATUSES)[number];

/** Nhãn tiếng Việt — dùng cho thông báo lỗi phía API và cho file export. */
export const KIND_LABEL: Record<SoftwareKind, string> = {
  license: 'License phần mềm',
  ssl: 'Chứng chỉ SSL',
  domain: 'Tên miền',
  maintenance: 'Hợp đồng bảo trì',
  other: 'Khác',
};

export const STATUS_LABEL: Record<SoftwareStatus, string> = {
  active: 'Đang dùng',
  expired_ok: 'Hết hạn, không gia hạn',
  retired: 'Đã bỏ',
};

export interface SoftwareInputShape {
  code?: string;
  name?: string;
  kind?: SoftwareKind;
  vendorId?: string | null;
  seatTotal?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  status?: SoftwareStatus;
}

/** Giá trị sau khi ghép bản sửa với hồ sơ đang có — thứ luật cần soi. */
export interface SoftwareEffective {
  kind: SoftwareKind;
  seatTotal: number | null;
  startDate: string | null;
  endDate: string | null;
}

/**
 * Loại nào BẮT BUỘC có ngày hết hạn.
 *
 * License / SSL / tên miền mà không có hạn thì cỗ máy cảnh báo (story 3.4) không nhắc được —
 * mà tránh "hết hạn bất ngờ" chính là lý do Epic 3 tồn tại. Hợp đồng bảo trì và "khác" thì
 * thả lỏng: có thứ ký vô thời hạn thật.
 */
export function requiresEndDate(kind: SoftwareKind): boolean {
  return kind === 'license' || kind === 'ssl' || kind === 'domain';
}

/** Chỉ license mới nói tới seat; loại khác điền seat là hiểu nhầm ý nghĩa cột. */
export function supportsSeats(kind: SoftwareKind): boolean {
  return kind === 'license';
}

/**
 * Trả về danh sách lỗi tiếng Việt (rỗng = hợp lệ).
 *
 * Trả mảng thay vì ném ở lỗi đầu tiên: màn import (và cả form) muốn hiện HẾT chỗ sai của
 * một dòng trong một lần, không bắt người dùng sửa từng cái rồi bấm lại.
 */
export function validateSoftware(effective: SoftwareEffective): string[] {
  const errors: string[] = [];

  if (requiresEndDate(effective.kind) && !effective.endDate) {
    errors.push(
      `${KIND_LABEL[effective.kind]} phải có ngày hết hạn — không có hạn thì hệ thống không nhắc gia hạn được.`,
    );
  }
  if (effective.startDate && effective.endDate && effective.endDate < effective.startDate) {
    errors.push('Ngày hết hạn phải sau ngày bắt đầu.');
  }
  if (effective.seatTotal !== null) {
    if (!supportsSeats(effective.kind)) {
      errors.push(
        `Chỉ ${KIND_LABEL.license} mới có số seat. Loại "${KIND_LABEL[effective.kind]}" hãy để trống ô này.`,
      );
    } else if (!Number.isInteger(effective.seatTotal) || effective.seatTotal < 1) {
      errors.push('Số seat phải là số nguyên từ 1 trở lên.');
    }
  }
  return errors;
}
