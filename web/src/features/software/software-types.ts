import { SOFTWARE_STATUS_TONE } from '@/lib/status-tone';

/* Danh sách loại nằm ở `lib/` vì bảng màn (`software-screens.ts`) và các màn tổng cũng cần nó. */
import type { SoftwareKind } from '@/lib/software-screens';
export { SOFTWARE_KINDS, type SoftwareKind } from '@/lib/software-screens';

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
  /** Ngày hệ thống sẽ tự Thanh lý hồ sơ Hết hạn (Q-13); server tính từ số ngày ân hạn. */
  autoRetireOn: string | null;
  /** Website dùng chứng chỉ SSL / tên miền này (Q-15). Tùy chọn: bản ghi dựng tay ở test không cần. */
  websites?: string[];
  /** Mã máy đang giữ ghế khớp ô tìm — chỉ danh sách có ô tìm trả về (SW-010). */
  matchedDevices?: string[];
}

/** Trang chi tiết: thêm hồ sơ Thanh lý lúc nào, do ai (`by = 'system'` khi tự động). */
export interface SoftwareDetailRow extends SoftwareRow {
  retirement: { at: string; by: string; auto: boolean } | null;
}

/**
 * Kỳ hạn + chi phí RIÊNG của một chỗ ngồi.
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
  /** Họ tên người làm — API tra (`withActorNames`); vắng thì panel hiện email. */
  actorName?: string | null;
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

/** Bản gốc (và luật màu) ở `lib/status-tone.ts` — Kho thanh lý tô cùng màu (Q-19). */
export const STATUS_TONE: Record<SoftwareStatus, string> = SOFTWARE_STATUS_TONE;

/** Chỉ license mới nói tới seat — khớp `supportsSeats` phía API. */
/**
 * Chữ của chip "khớp máy …" (SW-010): tối đa ba mã rồi "+N" — tìm theo chữ chung ("LT-") có
 * thể khớp hàng chục máy, và chip dài hơn cả dòng thì che mất chính hồ sơ.
 */
export function matchedDevicesText(codes: string[] | undefined): string | null {
  if (!codes || codes.length === 0) return null;
  const shown = codes.slice(0, 3).join(', ');
  return codes.length > 3 ? `${shown} +${codes.length - 3}` : shown;
}

export function supportsSeats(kind: SoftwareKind): boolean {
  return kind === 'license';
}

/** Chỉ SSL và tên miền có danh sách website — khớp `supportsWebsites` phía API. */
export function supportsWebsites(kind: SoftwareKind): boolean {
  return kind === 'ssl' || kind === 'domain';
}

/** Ô "mỗi dòng một website" → mảng; API tự chuẩn hóa phần còn lại. */
export function websiteLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Loại + kỳ hạn nào BẮT BUỘC có ngày hết hạn — bản đọc của `requiresEndDate` phía API
 * (`software-rules.ts`). Form báo ngay tại ô thay vì gửi lên cho server từ chối.
 */
export function requiresEndDate(kind: SoftwareKind, licenseModel: LicenseModel): boolean {
  if (kind === 'license') return licenseModel !== 'perpetual';
  return kind === 'ssl' || kind === 'domain';
}

/** Tiền tố mã theo nếp dữ liệu đang có (LIC-, SSL-…) — chỉ để gợi ý trong ô Mã. */
export function codePrefix(kind: SoftwareKind): string {
  return { license: 'LIC-', ssl: 'SSL-', domain: 'DOM-', maintenance: 'MNT-', other: '' }[kind];
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
 *
 * `before` là tổng ghế đang lưu (null khi tạo mới hoặc đang "không giới hạn"). Vượt ghế là
 * trạng thái hợp lệ, nên chỉ báo `belowUsed` khi lượt sửa ĐỔI tổng — cùng luật
 * `seatConflicts(beforeSeatTotal)` của API; chặn cả khi tổng giữ nguyên thì license đang vượt
 * không sửa được gì trên form.
 */
export function seatCheck(
  raw: string,
  hasSeats: boolean,
  used: number,
  before: number | null = null,
): { value: number | null; reason: 'invalid' | 'belowUsed' | null } {
  const text = raw.trim();
  if (!hasSeats || text === '') return { value: null, reason: null };
  if (!/^\d+$/.test(text) || Number(text) < 1) return { value: null, reason: 'invalid' };
  const value = Number(text);
  return { value, reason: value < used && value !== before ? 'belowUsed' : null };
}
