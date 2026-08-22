import type { SoftwareKind, SoftwareStatus } from './software-rules';

export interface SoftwareRecord {
  id: string;
  code: string;
  name: string;
  kind: SoftwareKind;
  vendorId: string | null;
  seatTotal: number | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  status: SoftwareStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Bản ghi kèm thứ màn hình cần mà không phải gọi thêm API. */
export interface SoftwareListItem extends SoftwareRecord {
  vendorName: string | null;
  /** Đã gán bao nhiêu seat (story 3.2). Loại không có seat thì luôn 0. */
  seatUsed: number;
}

export interface SoftwareHistoryRecord {
  id: string;
  softwareId: string;
  action: string;
  actor: string;
  changes: Record<string, unknown> | null;
  createdAt: Date;
}

export interface SoftwareFilter {
  search?: string;
  kind?: SoftwareKind;
  status?: SoftwareStatus;
  vendorId?: string;
}
