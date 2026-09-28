export const ISP_STATUSES = ['active', 'suspended', 'terminated'] as const;
export type IspStatus = (typeof ISP_STATUSES)[number];

export interface IspRow {
  id: string;
  code: string;
  /** Tên nhà mạng lấy từ danh mục — server giữ khớp với `providerId`. */
  provider: string;
  providerId: string;
  bandwidth: string | null;
  wanIp: string | null;
  siteId: string | null;
  siteCode: string | null;
  deviceId: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  hotline: string | null;
  contractNo: string | null;
  startDate: string | null;
  note: string | null;
  status: IspStatus;
  createdAt: string;
  updatedAt: string;
}

export interface IspHistoryRow {
  id: string;
  action: string;
  actor: string;
  changes: Record<string, { before: unknown; after: unknown }> | null;
  createdAt: string;
  /** Họ tên người làm — API tra theo email (`withActorNames`); vắng thì hiện email. */
  actorName?: string | null;
}

export const STATUS_KEY: Record<IspStatus, string> = {
  active: 'isp.statusActive',
  suspended: 'isp.statusSuspended',
  terminated: 'isp.statusTerminated',
};

/**
 * Nhãn NÚT đưa đường sang từng trạng thái. Khác nhãn trạng thái: trạng thái là "Đã thanh lý",
 * nút là "Thanh lý" (Q-14) — dùng `STATUS_KEY` làm nhãn nút là in "Đã thanh lý" lên nút.
 */
export const ACTION_KEY: Record<IspStatus, string> = {
  active: 'isp.actionActive',
  suspended: 'isp.actionSuspended',
  terminated: 'isp.actionTerminated',
};

export const STATUS_TONE: Record<IspStatus, string> = {
  active: 'ok',
  suspended: 'warn',
  terminated: 'muted',
};
