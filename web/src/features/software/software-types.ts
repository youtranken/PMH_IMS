/** Loại hồ sơ phần mềm — khớp `SOFTWARE_KINDS` phía API. */
export const SOFTWARE_KINDS = ['license', 'ssl', 'domain', 'maintenance', 'other'] as const;
export type SoftwareKind = (typeof SOFTWARE_KINDS)[number];

export const SOFTWARE_STATUSES = ['active', 'expired_ok', 'retired'] as const;
export type SoftwareStatus = (typeof SOFTWARE_STATUSES)[number];

export interface SoftwareRow {
  id: string;
  code: string;
  name: string;
  kind: SoftwareKind;
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
}

export interface SoftwareHistoryRow {
  id: string;
  action: string;
  actor: string;
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

export const STATUS_TONE: Record<SoftwareStatus, string> = {
  active: 'ok',
  expired_ok: 'muted',
  retired: 'muted',
};

/** Chỉ license mới nói tới seat — khớp `supportsSeats` phía API. */
export function supportsSeats(kind: SoftwareKind): boolean {
  return kind === 'license';
}

/** "3/10" hoặc gạch nếu loại không có seat. */
export function seatLabel(row: SoftwareRow): string {
  if (!supportsSeats(row.kind) || row.seatTotal === null) return '—';
  return `${row.seatUsed}/${row.seatTotal}`;
}
