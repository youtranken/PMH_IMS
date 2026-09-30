import { isIpv4OrCidr } from '@/lib/ipv4';
import { stripDiacritics } from '@/lib/search-fold';

/**
 * Xem trước mã API sẽ đặt khi ô Mã để trống — bản web của `codeFromLogin` (API), cùng bảng
 * kiểm (`code-preview.test.ts`). API có thể thêm hậu tố "-2", "-3" nếu mã đã có người dùng,
 * nên nơi hiện phải nói đây là GỐC của mã.
 */
export function previewCodeFromLogin(login: string): string {
  const local = login.trim().split('@')[0] ?? '';
  const slug = stripDiacritics(local)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'TK';
}

export const SERVICE_ACCOUNT_KINDS = ['shared', 'vpn'] as const;
export type ServiceAccountKind = (typeof SERVICE_ACCOUNT_KINDS)[number];

export const SERVICE_ACCOUNT_STATUSES = ['active', 'disabled'] as const;
export type ServiceAccountStatus = (typeof SERVICE_ACCOUNT_STATUSES)[number];

export interface ServiceAccountRow {
  id: string;
  code: string;
  kind: ServiceAccountKind;
  name: string;
  login: string | null;
  department: string | null;
  ownerName: string | null;
  /** Hai trường dưới CHỈ có nghĩa với kind='vpn' — bản đọc của `service-account-rules.ts`. */
  groupName: string | null;
  allowedIps: string | null;
  note: string | null;
  status: ServiceAccountStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  warnings?: string[];
}

export interface ServiceAccountHistoryRow {
  id: string;
  action: string;
  actor: string;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
  /** Họ tên người làm — API tra theo email (`withActorNames`); vắng thì hiện email. */
  actorName?: string | null;
}

export const KIND_KEY: Record<ServiceAccountKind, string> = {
  shared: 'serviceAccounts.kindShared',
  vpn: 'serviceAccounts.kindVpn',
};

/**
 * Nhãn NGẮN cho chip loại trên bảng — cả màn đã tên "Tài khoản dịch vụ", lặp chữ "Tài khoản"
 * ở mọi dòng chỉ làm cột Loại rộng ra. Ô chọn trong form/bộ lọc vẫn dùng tên đầy đủ.
 */
export const KIND_SHORT_KEY: Record<ServiceAccountKind, string> = {
  shared: 'serviceAccounts.kindSharedShort',
  vpn: 'serviceAccounts.kindVpnShort',
};

/** Hai loại hai màu, lấy từ token qua lớp `.badge` — liếc là tách được VPN khỏi dùng chung. */
export const KIND_TONE: Record<ServiceAccountKind, string> = {
  shared: 'muted',
  vpn: 'brand',
};

/**
 * Dải IP được phép "mọi nơi": trống, hoặc có 0.0.0.0/0. Với tài khoản VPN đó là điều người
 * kiểm toán phải thấy ngay — VPN mở cho mọi IP nguồn.
 */
export function allowsAnyIp(kind: ServiceAccountKind, allowedIps: string | null): boolean {
  if (kind !== 'vpn') return false;
  const entries = splitAllowedIps(allowedIps ?? '');
  return entries.length === 0 || entries.includes('0.0.0.0/0');
}

/** Các mục của ô "Dải IP được phép" — ngăn bằng phẩy, chấm phẩy hoặc xuống dòng (cùng `checkAllowedIps` của API). */
function splitAllowedIps(text: string): string[] {
  return text
    .split(/[,\n;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Những mục KHÔNG phải IPv4 hay CIDR — báo ngay dưới ô khi gõ, thay vì đợi API từ chối lúc
 * bấm Lưu. API (`service-account-rules.ts`) vẫn là hàng rào thật.
 */
export function invalidAllowedIps(text: string): string[] {
  return splitAllowedIps(text).filter((entry) => !isIpv4OrCidr(entry));
}

export const STATUS_KEY: Record<ServiceAccountStatus, string> = {
  active: 'serviceAccounts.statusActive',
  disabled: 'serviceAccounts.statusDisabled',
};

export const STATUS_TONE: Record<ServiceAccountStatus, string> = {
  active: 'ok',
  disabled: 'danger',
};

/**
 * Ô nào thuộc loại nào — bản đọc của `supportsVpnFields` phía API.
 *
 * Client giữ bản này chỉ để biết hiện ô nào; API vẫn là nơi phán. Lệch nhau thì tệ nhất là
 * hiện thừa một ô rồi bị API từ chối kèm lời giải thích, chứ không phải ghi ra dữ liệu sai.
 */
export function supportsVpnFields(kind: ServiceAccountKind): boolean {
  return kind === 'vpn';
}
