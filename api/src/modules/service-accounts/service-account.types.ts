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
  /** Chỉ tài khoản VPN mở cho mọi IP nguồn (dải trống hoặc có `0.0.0.0/0`). */
  anyIp?: boolean;
}

export interface ServiceAccountInput {
  /**
   * Để trống khi TẠO MỚI thì service suy từ tên đăng nhập (`fillBlanks`).
   *
   * Vẫn là khóa duy nhất và vẫn hiện trên mọi dòng lịch sử — chỉ là người khai không phải
   * nghĩ ra nó. Suy không được (không có cả login) thì `validateServiceAccount` báo thiếu.
   */
  code?: string;
  kind: ServiceAccountKind;
  /** Để trống khi TẠO MỚI thì lấy tên đăng nhập làm tên gọi. */
  name?: string;
  login?: string;
  department?: string;
  ownerName?: string;
  groupName?: string;
  allowedIps?: string;
  note?: string;
  /*
   * KHÔNG có `status` ở đây, và đó là chủ ý.
   *
   * Trạng thái chỉ đổi qua `disable()` / `enable()` — hai đường DUY NHẤT bắt ghi lý do và để
   * lại một dòng lịch sử nói đúng việc vừa làm. Để `status` lọt vào bộ ô sửa bình thường thì
   * `PATCH {status:'active'}` bật lại một tài khoản vừa bị đóng mà không lý do, lịch sử chỉ
   * ghi "Sửa hồ sơ", và cái luật "sáu tháng sau sẽ có người hỏi vì sao" thành ra vô nghĩa.
   */
}
