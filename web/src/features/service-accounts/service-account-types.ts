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
}

export const KIND_KEY: Record<ServiceAccountKind, string> = {
  shared: 'serviceAccounts.kindShared',
  vpn: 'serviceAccounts.kindVpn',
};

export const STATUS_KEY: Record<ServiceAccountStatus, string> = {
  active: 'serviceAccounts.statusActive',
  disabled: 'serviceAccounts.statusDisabled',
};

export const STATUS_TONE: Record<ServiceAccountStatus, string> = {
  active: 'ok',
  disabled: 'muted',
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
