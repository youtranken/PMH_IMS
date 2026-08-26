/**
 * Luật hồ sơ tài khoản dịch vụ — hàm THUẦN, không chạm DB.
 *
 * Hai loại dùng chung một bảng nhưng KHÔNG dùng chung bộ ô: nhóm VPN và dải IP được phép chỉ
 * có nghĩa với tài khoản VPN. Khai chúng cho một email dùng chung là ghi ra dữ liệu vô nghĩa
 * mà sáu tháng sau không ai dám xóa vì không biết nó từng có ý gì.
 */
export const SERVICE_ACCOUNT_KINDS = ['shared', 'vpn'] as const;
export type ServiceAccountKind = (typeof SERVICE_ACCOUNT_KINDS)[number];

export const SERVICE_ACCOUNT_STATUSES = ['active', 'disabled'] as const;
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

  if (!draft.code.trim()) errors.push('Cần mã tài khoản để gọi tên nó trong biên bản.');
  if (!draft.name.trim()) errors.push('Cần tên tài khoản.');

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
