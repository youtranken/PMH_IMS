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
  expired_ok: 'Hết hạn',
  // Q-14: nhãn TRẠNG THÁI là "Đã thanh lý"; "Thanh lý" là nhãn nút.
  retired: 'Đã thanh lý',
};

/**
 * Trạng thái hiệu lực (DOM-03, `docs/QUYET-DINH.md` Q-03). Người chỉ quyết Thanh lý; hai trạng
 * thái còn lại do HẠN quyết: qua ngày hết hạn là Hết hạn (thôi nhắc — mail "sắp hết hạn" đã gửi
 * trước đó), nhập ngày mới là về Đang dùng. Ngày hết hạn tính trọn ngày, nên hết hạn hôm nay vẫn
 * là Đang dùng. `today` là ngày theo `app.timezone`, dạng YYYY-MM-DD.
 */
export function effectiveSoftwareStatus(
  status: SoftwareStatus,
  endDate: string | null,
  today: string,
): SoftwareStatus {
  if (status === 'retired') return 'retired';
  return endDate !== null && endDate < today ? 'expired_ok' : 'active';
}

/**
 * Ngày lượt quét sẽ tự Thanh lý hồ sơ Hết hạn (Q-13), hoặc `null` khi không có chuyện đó.
 *
 * Lượt quét thanh lý khi `end_date < today - grace`, tức từ ngày `end + grace + 1`. Hàm này
 * phải khớp đúng điều kiện ấy: màn hình đếm ngược tới đây, lệch một ngày là màn hứa sai.
 * `graceDays <= 0` nghĩa là tắt tự thanh lý (migration 0076).
 */
export function autoRetireOn(
  status: SoftwareStatus,
  endDate: string | null,
  graceDays: number,
): string | null {
  if (status !== 'expired_ok' || endDate === null || graceDays <= 0) return null;
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + graceDays + 1);
  return date.toISOString().slice(0, 10);
}

export interface SoftwareInputShape {
  code?: string;
  name?: string;
  kind?: SoftwareKind;
  licenseModel?: LicenseModel;
  vendorId?: string | null;
  seatTotal?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  note?: string | null;
  status?: SoftwareStatus;
  websites?: string[];
}

/** Giá trị sau khi ghép bản sửa với hồ sơ đang có — thứ luật cần soi. */
export interface SoftwareEffective {
  kind: SoftwareKind;
  licenseModel: LicenseModel;
  seatTotal: number | null;
  startDate: string | null;
  endDate: string | null;
}

/**
 * Kỳ hạn của license: thuê bao (có hạn, phải gia hạn) hay mua đứt (dùng mãi).
 *
 * Chỉ có nghĩa với `license`. SSL và tên miền LUÔN có kỳ hạn — nhà cung cấp không bán vĩnh
 * viễn — nên đánh dấu vĩnh viễn cho chúng là khai sai, chặn ngay ở luật.
 */
export const LICENSE_MODELS = ['subscription', 'perpetual'] as const;
export type LicenseModel = (typeof LICENSE_MODELS)[number];

/**
 * Loại nào BẮT BUỘC có ngày hết hạn.
 *
 * License / SSL / tên miền mà không có hạn thì cỗ máy cảnh báo (story 3.4) không nhắc được —
 * mà tránh "hết hạn bất ngờ" chính là lý do Epic 3 tồn tại. Hợp đồng bảo trì và "khác" thì
 * thả lỏng: có thứ ký vô thời hạn thật.
 *
 * NGOẠI LỆ: license mua đứt không có ngày hết hạn để mà nhắc. Bắt nhập là ép người dùng bịa
 * một ngày, rồi tới ngày đó hệ thống đi nhắc gia hạn một thứ không cần gia hạn — tệ hơn là
 * không nhắc, vì nhắc sai làm người ta mất tin vào mọi lời nhắc còn lại.
 */
export function requiresEndDate(
  kind: SoftwareKind,
  licenseModel: LicenseModel = 'subscription',
): boolean {
  if (kind === 'license') return licenseModel !== 'perpetual';
  return kind === 'ssl' || kind === 'domain';
}

/**
 * Kỳ hạn và chi phí RIÊNG của một chỗ ngồi (bản ghi gán) — migration 0027.
 *
 * Vì sao không nằm ở hồ sơ: một license 10 ghế thường không mua một lần. Phòng Kế toán mua
 * 3 ghế theo hợp đồng HD-2026-014 giá 3,5tr/ghế kỳ 2026, Xưởng mua thêm 2 ghế hợp đồng khác
 * giá khác kỳ khác. Nhét vào hồ sơ chung thì mọi con số đó chỉ còn một ô duy nhất, và câu
 * "ghế này của hợp đồng nào, hết hạn khi nào" không trả lời được nữa.
 *
 * Mọi trường đều TÙY CHỌN: gán nhanh một máy rồi bổ sung giấy tờ sau là việc có thật, bắt
 * nhập đủ ngay lúc gán chỉ khiến người ta điền bừa cho qua.
 */
export interface AssignmentTerms {
  /** Tiền đồng, số nguyên (VND không có phần lẻ). */
  cost: number | null;
  contract: string | null;
  startDate: string | null;
  endDate: string | null;
}

export function validateAssignmentTerms(
  terms: AssignmentTerms,
  licenseModel: LicenseModel = 'subscription',
): string[] {
  const errors: string[] = [];

  if (terms.cost !== null) {
    // `cost` là cột bigint. Quá 2^53 thì JavaScript đọc ra một con số KHÁC lúc ghi vào mà
    // không có lỗi nào — tiền lặng lẽ sai chữ số cuối là thứ không được phép xảy ra.
    if (
      !Number.isInteger(terms.cost) ||
      terms.cost < 0 ||
      terms.cost > Number.MAX_SAFE_INTEGER
    ) {
      errors.push('Chi phí phải là số nguyên tiền đồng, không âm.');
    }
  }
  if (terms.startDate && terms.endDate && terms.endDate < terms.startDate) {
    errors.push('Ngày kết thúc của ghế phải sau ngày bắt đầu.');
  }
  if (licenseModel === 'perpetual' && terms.endDate) {
    errors.push(
      'License vĩnh viễn thì ghế không có ngày kết thúc. Bỏ ngày kết thúc, hoặc đổi kỳ hạn hồ sơ sang thuê bao.',
    );
  }
  return errors;
}

/** Chỉ license mới nói tới seat; loại khác điền seat là hiểu nhầm ý nghĩa cột. */
export function supportsSeats(kind: SoftwareKind): boolean {
  return kind === 'license';
}

/** Chỉ chứng chỉ SSL và tên miền mới "dùng cho website nào" (Q-15). */
export function supportsWebsites(kind: SoftwareKind): boolean {
  return kind === 'ssl' || kind === 'domain';
}

const WEBSITES_MAX = 200;
const WEBSITE_MAX_LENGTH = 253;

/**
 * Chuẩn hóa danh sách website của một chứng chỉ / tên miền (Q-15, SW-043).
 *
 * Người ta dán URL từ trình duyệt ("https://Shop.pmh.vn/") — lưu nguyên thì ô tìm "shop.pmh.vn"
 * vẫn ra, nhưng sổ gia hạn các năm sẽ có ba cách viết cho cùng một website và câu hỏi "năm
 * 2025 cert này phủ những website nào" đếm sai. Nên bỏ giao thức, dấu / cuối, hạ chữ thường,
 * bỏ trùng. Khoảng trắng giữa dòng là hai website dán chung một dòng: báo lỗi, không đoán.
 */
export function normalizeWebsites(list: readonly string[]): { value: string[]; errors: string[] } {
  const value: string[] = [];
  const errors: string[] = [];
  for (const raw of list) {
    const site = raw
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
    if (!site) continue;
    if (/\s/.test(site)) {
      errors.push(`Website "${raw.trim()}" có khoảng trắng — mỗi dòng một website.`);
      continue;
    }
    if (site.length > WEBSITE_MAX_LENGTH) {
      errors.push(`Website "${site.slice(0, 40)}…" dài quá ${WEBSITE_MAX_LENGTH} ký tự.`);
      continue;
    }
    if (!value.includes(site)) value.push(site);
  }
  if (value.length > WEBSITES_MAX) {
    errors.push(`Tối đa ${WEBSITES_MAX} website cho một hồ sơ.`);
  }
  return { value, errors };
}

/**
 * Hồ sơ sau khi sửa còn chứa nổi các ghế đang gán không (rỗng = được).
 *
 * Ghế gán là dữ liệu của máy khác, không phải của form này: đổi loại, chuyển vĩnh viễn, hạ
 * trần hay thanh lý mà bỏ mặc chúng thì còn lại những dòng gán mà luật của chính hồ sơ không
 * nhận — ghế của một "SSL", ghế có hạn trên license vĩnh viễn, 12/10 ghế không ai khai lý do
 * vượt. Người sửa phải tự gỡ hay sửa ghế trước, để việc đó có tên người và dòng lịch sử.
 */
export function seatConflicts(
  next: {
    kind: SoftwareKind;
    licenseModel: LicenseModel;
    seatTotal: number | null;
    status: SoftwareStatus;
  },
  seats: { used: number; withEndDate: number },
  /** Tổng ghế TRƯỚC khi sửa. Vượt ghế là trạng thái hợp lệ (gán vượt phải ghi lý do), nên chỉ
   *  chặn khi lượt sửa ĐỔI tổng xuống dưới số đang dùng — không chặn sửa ghi chú. */
  beforeSeatTotal?: number | null,
): string[] {
  if (seats.used === 0) return [];
  // Thanh lý KHÔNG phải xung đột, kể cả khi đang vượt trần hay đổi luôn loại/mô hình: service gỡ
  // mọi ghế trong cùng transaction (QUYET-DINH Q-03), nên không còn ghế nào để luật của hồ sơ soi.
  if (next.status === 'retired') return [];
  const errors: string[] = [];
  if (!supportsSeats(next.kind)) {
    errors.push(
      `Đang có ${seats.used} ghế gán vào máy — chỉ ${KIND_LABEL.license} mới có ghế. Gỡ hết ghế trước khi đổi loại.`,
    );
  }
  if (next.licenseModel === 'perpetual' && seats.withEndDate > 0) {
    errors.push(
      `Có ${seats.withEndDate} ghế đang ghi ngày hết hạn, mà bản vĩnh viễn thì ghế không có hạn. Bỏ ngày hết hạn của các ghế đó trước.`,
    );
  }
  if (
    next.seatTotal !== null &&
    next.seatTotal < seats.used &&
    next.seatTotal !== beforeSeatTotal
  ) {
    errors.push(
      `Đang dùng ${seats.used} ghế, không hạ tổng xuống ${next.seatTotal} được. Gỡ bớt ghế trước.`,
    );
  }
  return errors;
}

/**
 * Trả về danh sách lỗi tiếng Việt (rỗng = hợp lệ).
 *
 * Trả mảng thay vì ném ở lỗi đầu tiên: màn import (và cả form) muốn hiện HẾT chỗ sai của
 * một dòng trong một lần, không bắt người dùng sửa từng cái rồi bấm lại.
 */
export function validateSoftware(effective: SoftwareEffective): string[] {
  const errors: string[] = [];

  if (requiresEndDate(effective.kind, effective.licenseModel) && !effective.endDate) {
    errors.push(
      `${KIND_LABEL[effective.kind]} phải có ngày hết hạn để hệ thống nhắc gia hạn.`,
    );
  }
  if (effective.licenseModel === 'perpetual') {
    // Hai lời khẳng định ngược nhau trên cùng một hồ sơ: hoặc dùng mãi, hoặc hết hạn ngày đó.
    if (effective.endDate) {
      errors.push(
        'Hồ sơ đánh dấu vĩnh viễn thì không có ngày hết hạn. Bỏ ngày hết hạn, hoặc đổi kỳ hạn sang thuê bao.',
      );
    }
    if (effective.kind !== 'license') {
      errors.push(
        `Chỉ ${KIND_LABEL.license} mới có kỳ hạn Vĩnh viễn. "${KIND_LABEL[effective.kind]}" luôn là Thuê bao.`,
      );
    }
  }
  if (effective.startDate && effective.endDate && effective.endDate < effective.startDate) {
    errors.push('Ngày hết hạn phải sau ngày bắt đầu.');
  }
  if (effective.seatTotal !== null) {
    if (!supportsSeats(effective.kind)) {
      errors.push(
        `Chỉ ${KIND_LABEL.license} mới có số ghế. Loại "${KIND_LABEL[effective.kind]}" hãy để trống ô này.`,
      );
    } else if (!Number.isInteger(effective.seatTotal) || effective.seatTotal < 1) {
      errors.push('Số ghế phải là số nguyên từ 1 trở lên.');
    }
  }
  return errors;
}
