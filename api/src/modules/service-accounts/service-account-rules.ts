/**
 * Luật hồ sơ tài khoản dịch vụ — hàm THUẦN, không chạm DB.
 *
 * Hai loại dùng chung một bảng nhưng KHÔNG dùng chung bộ ô: nhóm VPN và dải IP được phép chỉ
 * có nghĩa với tài khoản VPN. Khai chúng cho một email dùng chung là ghi ra dữ liệu vô nghĩa
 * mà sáu tháng sau không ai dám xóa vì không biết nó từng có ý gì.
 */
import { stripDiacritics } from '../../common/search-fold';
import { viDate } from '../../common/today';

export const SERVICE_ACCOUNT_KINDS = ['shared', 'vpn'] as const;
export type ServiceAccountKind = (typeof SERVICE_ACCOUNT_KINDS)[number];

export const SERVICE_ACCOUNT_STATUSES =['active', 'disabled'] as const;
export type ServiceAccountStatus = (typeof SERVICE_ACCOUNT_STATUSES)[number];

const KIND_LABEL: Record<ServiceAccountKind, string> = {
  shared: 'Tài khoản dùng chung',
  vpn: 'Tài khoản VPN',
};

/** Ô nào chỉ thuộc về loại nào — nguồn sự thật cho cả validate lẫn form. */
export function supportsVpnFields(kind: ServiceAccountKind): boolean {
  return kind === 'vpn';
}

export interface ServiceAccountDraft {
  code: string;
  kind: ServiceAccountKind;
  name: string;
  login?: string | null;
  department?: string | null;
  ownerName?: string | null;
  groupName?: string | null;
  allowedIps?: string | null;
}

/**
 * Một mục trong danh sách IP được phép: IPv4 đơn hoặc CIDR.
 *
 * Nhận CIDR bất kỳ prefix (kể cả /0) — đây là danh sách IP của CLIENT ngoài Internet, không
 * phải dải nội bộ, nên trần /24 của IPAM không áp ở đây. Nhưng /0 thì cảnh báo: "cho phép cả
 * Internet" hầu như luôn là gõ nhầm, và nếu đúng ý thì vẫn lưu được.
 */
const IPV4_OR_CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;

export interface AllowedIpsCheck {
  /** Mục sai định dạng — chặn lưu. */
  invalid: string[];
  /** Mục hợp lệ nhưng mở quá rộng — chỉ cảnh báo. */
  tooWide: string[];
  /** Danh sách đã chuẩn hóa (bỏ khoảng trắng, bỏ mục rỗng, bỏ trùng). */
  normalized: string[];
}

/**
 * Đọc danh sách IP được phép. Ngăn bằng dấu phẩy hoặc xuống dòng — người ta dán từ email,
 * từ Excel, từ chat, mỗi nơi một kiểu ngắt.
 */
export function checkAllowedIps(value: string): AllowedIpsCheck {
  const invalid: string[] = [];
  const tooWide: string[] = [];
  const normalized: string[] = [];

  for (const raw of value.split(/[,\n;]/)) {
    const text = raw.trim();
    if (!text) continue;

    const match = IPV4_OR_CIDR.exec(text);
    if (!match) {
      invalid.push(text);
      continue;
    }
    const octets = [match[1], match[2], match[3], match[4]].map(Number);
    if (octets.some((octet) => octet > 255)) {
      invalid.push(text);
      continue;
    }
    const prefix = match[5] === undefined ? 32 : Number(match[5]);
    if (prefix > 32) {
      invalid.push(text);
      continue;
    }
    // /8 trở xuống là hàng triệu địa chỉ. Vẫn lưu được — có thể đúng ý — nhưng phải nói ra.
    if (prefix <= 8) tooWide.push(text);
    if (!normalized.includes(text)) normalized.push(text);
  }

  return { invalid, tooWide, normalized };
}

/**
 * Sinh MÃ từ tên đăng nhập — để người khai không phải nghĩ ra một cái mã.
 *
 * Việc thật: người ta biết tài khoản đó đăng nhập bằng gì (`ketoan@pmh.com.vn`, `vpn-lan`),
 * còn "mã tài khoản" là thứ hệ thống cần chứ người dùng không cần. Bắt gõ là bắt bịa, và mỗi
 * người bịa một kiểu — đúng thứ làm cột mã trở nên vô dụng.
 *
 * Vẫn GIỮ cột mã: nó là khóa duy nhất, là thứ hiện trên mọi dòng lịch sử, mọi biên bản. Chỉ
 * là hệ thống tự lo khi ô để trống.
 *
 * Quy tắc: lấy phần trước `@`, bỏ dấu tiếng Việt, viết hoa, mọi thứ không phải chữ-số thành
 * `-`. Rỗng (login toàn ký tự lạ) → `TK` để còn có cái mà thêm số vào.
 */
export function codeFromLogin(login: string): string {
  const local = login.trim().split('@')[0] ?? '';
  // Bỏ dấu qua bản DÙNG CHUNG (B-01): bốn dòng viết tay ở đây là bản sao thứ hai của cùng
  // phép gấp dấu, và nó dùng lớp ký tự tổ hợp viết TRẦN trong mã nguồn — đúng thứ chú thích
  // của `search-fold.ts` cảnh báo là formatter có thể nuốt mất mà không ai thấy.
  const slug = stripDiacritics(local)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'TK';
}

/** Ô có thể để trống — đúng bộ ô mà "không gửi" khác hẳn "gửi chuỗi rỗng". */
export const SERVICE_ACCOUNT_OPTIONAL_FIELDS =[
  'login',
  'department',
  'ownerName',
  'groupName',
  'allowedIps',
  'note',
  /** Hạn dùng `YYYY-MM-DD` (Q-20). Trống = không có hạn. */
  'endDate',
] as const;
export type ServiceAccountOptionalField = (typeof SERVICE_ACCOUNT_OPTIONAL_FIELDS)[number];

/**
 * Body một lần ghi: ô vắng mặt = "đừng đụng tới".
 *
 * `code`/`name` để `string | undefined` vì lúc TẠO chúng có thể được suy ra sau (`fillBlanks`
 * ở service). `mergeServiceAccount` chỉ chuyển tiếp chúng nguyên vẹn —
 * `validateServiceAccount` mới là chỗ phán "thiếu mã" / "thiếu tên", và nó đọc chuỗi rỗng.
 */
export type ServiceAccountPatch = {
  code?: string;
  kind: ServiceAccountKind;
  name?: string;
} & Partial<Record<ServiceAccountOptionalField, string>>;

/** Dòng đang nằm trong DB — chỉ phần ô tùy chọn, đủ để `merge` lấp chỗ trống. */
export type ServiceAccountStored = Record<ServiceAccountOptionalField, string | null>;

export type ServiceAccountMerged = ServiceAccountDraft &
  Record<ServiceAccountOptionalField, string | null>;

/**
 * Ghép body với dòng đang có — GIÁ TRỊ SẼ NẰM TRONG DB sau lần ghi này.
 *
 * Ba luật, và cả ba đều từng cắn thật:
 *
 * 1. **Ô không gửi = giữ nguyên**, không phải xoá. Mọi ô trong DTO đều `@IsOptional()`, nên
 *    `PATCH {code, kind, name}` — đúng bộ tối thiểu DTO cho phép — từng ghi `null` đè lên tên
 *    đăng nhập, bộ phận, người phụ trách, nhóm VPN, dải IP và ghi chú, rồi vào lịch sử như một
 *    lần sửa bình thường.
 * 2. **Gửi chuỗi rỗng = xoá thật.** Người dùng xoá trắng một ô trên form là có ý.
 * 3. **Kiểm luật phải chạy trên bản ĐÃ GHÉP, không trên body.** Kiểm trên body thì `PATCH
 *    {code, kind, name}` lên một tài khoản VPN đang để `allowedIps = '0.0.0.0/0'` trả về
 *    `warnings: []` — đọc thành "kiểm rồi, sạch" cho một dòng vẫn mở toang cho cả internet.
 *
 * Tách khỏi service để test bằng bảng dữ liệu, không phải dựng DB lên mới biết nó ghép đúng.
 */
export function mergeServiceAccount(
  input: ServiceAccountPatch,
  before?: ServiceAccountStored | null,
): ServiceAccountMerged {
  const vpn = supportsVpnFields(input.kind);
  const keep = (key: ServiceAccountOptionalField): string | null => {
    const raw = input[key];
    if (raw === undefined) return before?.[key] ?? null;
    const text = raw.trim();
    return text === '' ? null : text;
  };
  /*
   * Ô của loại KHÁC không được lấp bằng giá trị cũ.
   *
   * Đổi một tài khoản từ VPN sang dùng chung mà body không gửi lại `groupName`: lấp bằng giá
   * trị cũ là `validateServiceAccount` báo "tài khoản dùng chung không có nhóm VPN" cho một ô
   * người dùng vừa cố tình bỏ đi. Với loại không hỗ trợ, chỉ nhìn đúng thứ body gửi lên.
   */
  const foreign = (key: ServiceAccountOptionalField): string | null => {
    const text = (input[key] ?? '').trim();
    return text === '' ? null : text;
  };

  return {
    // `?? ''` để `validateServiceAccount` thấy một chuỗi rỗng và báo "cần mã tài khoản",
    // thay vì nổ khi gọi `.trim()` trên `undefined`.
    code: input.code ?? '',
    kind: input.kind,
    name: input.name ?? '',
    login: keep('login'),
    department: keep('department'),
    ownerName: keep('ownerName'),
    groupName: vpn ? keep('groupName') : foreign('groupName'),
    allowedIps: vpn ? keep('allowedIps') : foreign('allowedIps'),
    note: keep('note'),
    endDate: keep('endDate'),
  };
}

/**
 * Gia hạn một tài khoản dịch vụ (Q-20) — trả câu lỗi, hoặc `null` nếu cho qua.
 *
 * Tài khoản đã ngừng dùng thì không gia hạn: nó đã rời danh sách nhắc hạn, và "gia hạn" nó là
 * mở lại bằng cửa sau, không ghi lý do như `enable()`. Hạn mới phải SAU hạn đang có — kéo hạn
 * lùi là sửa nhầm, việc đó làm ở Sửa hồ sơ để lịch sử ghi đúng là "sửa", không phải "gia hạn".
 */
export function checkServiceAccountRenewal(
  current: { status: string; endDate: string | null },
  newEnd: string,
): string | null {
  if (current.status !== 'active') {
    return 'Tài khoản này đã ngừng dùng nên không gia hạn được. Dùng lại trước nếu vẫn cần.';
  }
  if (current.endDate && newEnd <= current.endDate) {
    return `Hạn mới (${viDate(newEnd)}) phải sau hạn hiện tại (${viDate(current.endDate)}). Sửa nhầm hạn thì dùng Sửa hồ sơ.`;
  }
  return null;
}

export interface ServiceAccountCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Trả về danh sách lỗi + cảnh báo (rỗng = hợp lệ).
 *
 * Trả mảng thay vì ném ở lỗi đầu tiên: form có bảy ô, sửa từng lỗi một là bảy lần bấm Lưu.
 * Cùng khuôn với `validateNatRule` và `validateSoftware`.
 */
export function validateServiceAccount(draft: ServiceAccountDraft): ServiceAccountCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft.code.trim()) errors.push('Thiếu mã tài khoản.');
  if (!draft.name.trim()) errors.push('Thiếu tên tài khoản.');

  const vpn = supportsVpnFields(draft.kind);

  if (!vpn) {
    // Ô của loại khác lọt vào là dữ liệu vô nghĩa — chặn ngay chứ không lặng lẽ bỏ qua, để
    // người khai biết mình đang gõ nhầm loại.
    if (draft.groupName?.trim()) {
      errors.push(`${KIND_LABEL[draft.kind]} không có nhóm VPN — để trống ô đó.`);
    }
    if (draft.allowedIps?.trim()) {
      errors.push(`${KIND_LABEL[draft.kind]} không có dải IP được phép — để trống ô đó.`);
    }
  }

  if (vpn && draft.allowedIps?.trim()) {
    const check = checkAllowedIps(draft.allowedIps);
    for (const item of check.invalid) {
      errors.push(`"${item}" không phải địa chỉ IPv4 hay dải CIDR hợp lệ.`);
    }
    for (const item of check.tooWide) {
      warnings.push(`Dải "${item}" mở rất rộng — kiểm lại xem có đúng ý không.`);
    }
  }

  return { errors, warnings };
}
