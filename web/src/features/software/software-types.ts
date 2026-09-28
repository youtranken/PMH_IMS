/** Loại hồ sơ phần mềm — khớp `SOFTWARE_KINDS` phía API. */
export const SOFTWARE_KINDS = ['license', 'ssl', 'domain', 'maintenance', 'other'] as const;
export type SoftwareKind = (typeof SOFTWARE_KINDS)[number];

/**
 * Kỳ hạn license: thuê bao (có ngày hết hạn, phải gia hạn) hay mua đứt (dùng mãi).
 * Chỉ có nghĩa với `license` — SSL và tên miền luôn có kỳ hạn của nhà cung cấp.
 */
export const LICENSE_MODELS = ['subscription', 'perpetual'] as const;
export type LicenseModel = (typeof LICENSE_MODELS)[number];

export const SOFTWARE_STATUSES = ['active', 'expired_ok', 'retired'] as const;
export type SoftwareStatus = (typeof SOFTWARE_STATUSES)[number];

export interface SoftwareRow {
  id: string;
  code: string;
  name: string;
  kind: SoftwareKind;
  licenseModel: LicenseModel;
  vendorId: string | null;
  vendorName: string | null;
  seatTotal: number | null;
  seatUsed: number;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  status: SoftwareStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Kỳ hạn + chi phí RIÊNG của một chỗ ngồi (migration 0027).
 *
 * Một license 10 ghế hầu như không mua một lần: Kế toán mua 3 ghế theo hợp đồng này, Xưởng
 * mua 2 ghế hợp đồng khác giá khác kỳ khác. Đây là chỗ giữ những con số đó.
 */
export interface SeatTerms {
  /** Tiền đồng, số nguyên. `null` = chưa khai, KHÁC với 0 (được tặng kèm). */
  cost: number | null;
  contract: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** Một chỗ ngồi của license — dòng trong khu bung ở danh sách phần mềm. */
export interface LicenseSeat extends SeatTerms {
  id: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  deviceAssignedTo: string | null;
  assignedBy: string;
  assignedAt: string;
  note: string | null;
}

/** Một license đang cài trên MỘT máy — dòng trong khu bung ở danh sách thiết bị. */
export interface InstalledLicense extends SeatTerms {
  id: string;
  softwareId: string;
  softwareCode: string;
  softwareName: string;
  licenseModel: LicenseModel;
  /** Hạn của HỒ SƠ — hiện khi ghế không khai kỳ hạn riêng. */
  softwareEndDate: string | null;
  assignedAt: string;
  note: string | null;
}

export interface SoftwareHistoryRow {
  id: string;
  action: string;
  actor: string;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
}

/** Khóa i18n của nhãn — không viết chuỗi cứng trong component (UX-DR4). */
export const KIND_KEY: Record<SoftwareKind, string> = {
  license: 'software.kindLicense',
  ssl: 'software.kindSsl',
  domain: 'software.kindDomain',
  maintenance: 'software.kindMaintenance',
  other: 'software.kindOther',
};

export const STATUS_KEY: Record<SoftwareStatus, string> = {
  active: 'software.statusActive',
  expired_ok: 'software.statusExpiredOk',
  retired: 'software.statusRetired',
};

export const STATUS_TONE: Record<SoftwareStatus, string> = {
  active: 'ok',
  expired_ok: 'muted',
  retired: 'muted',
};

/** Chỉ license mới nói tới seat — khớp `supportsSeats` phía API. */
export function supportsSeats(kind: SoftwareKind): boolean {
  return kind === 'license';
}

/** "3/10" hoặc gạch nếu loại không có seat. */
export function seatLabel(row: SoftwareRow): string {
  if (!supportsSeats(row.kind) || row.seatTotal === null) return '—';
  return `${row.seatUsed}/${row.seatTotal}`;
}

/**
 * Ô Số ghế → giá trị gửi lên API (SW-025).
 *
 * Trả MỘT hình dạng `{ value, reason }` (tsconfig web không bật `strict`, union `ok` không thu
 * hẹp được). `Number("10 ghế")` là NaN và `JSON.stringify(NaN)` là `null` — tức "không giới
 * hạn" — nên chuỗi không thuần chữ số phải bị báo, không được đổi thành số.
 */
export function seatCheck(
  raw: string,
  hasSeats: boolean,
  used: number,
): { value: number | null; reason: 'invalid' | 'belowUsed' | null } {
  const text = raw.trim();
  if (!hasSeats || text === '') return { value: null, reason: null };
  if (!/^\d+$/.test(text) || Number(text) < 1) return { value: null, reason: 'invalid' };
  const value = Number(text);
  return { value, reason: value < used ? 'belowUsed' : null };
}
