import type { ServiceAccountKind, ServiceAccountStatus } from './service-account-rules';

export interface ServiceAccountRecord {
  id: string;
  code: string;
  kind: ServiceAccountKind;
  name: string;
  login: string | null;
  department: string | null;
  ownerName: string | null;
  /** Hai trường dưới CHỈ có nghĩa với kind='vpn'. */
  groupName: string | null;
  allowedIps: string | null;
  note: string | null;
  status: ServiceAccountStatus;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  /** Chỉ có ở kết quả ghi: điều đáng nói nhưng không đủ để chặn (vd dải IP mở quá rộng). */
  warnings?: string[];
}

export interface ServiceAccountHistoryRecord {
  id: string;
  serviceAccountId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ServiceAccountFilter {
  search?: string;
  kind?: ServiceAccountKind;
  status?: ServiceAccountStatus;
}

export interface ServiceAccountInput {
  code: string;
  kind: ServiceAccountKind;
  name: string;
  login?: string;
  department?: string;
  ownerName?: string;
  groupName?: string;
  allowedIps?: string;
  note?: string;
  status?: ServiceAccountStatus;
}
