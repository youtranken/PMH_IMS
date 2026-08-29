/** Các loại mục danh mục — trùng `CatalogEntity` phía API, dùng làm đoạn đường dẫn. */
export const CATALOG_ENTITIES = [
  'site',
  'cabinet',
  'device_type',
  'vendor',
  'department',
  'isp_provider',
  'service_port',
] as const;
export type CatalogEntity = (typeof CATALOG_ENTITIES)[number];

/**
 * Loại nhập được từ file Excel — khớp `IMPORTABLE_ENTITIES` phía API.
 *
 * Ba danh mục của 0028 chỉ vài chục dòng, khai tay trong hai phút; kéo chúng vào file mẫu là
 * thêm ba sheet mà không ai dùng.
 */
export const IMPORTABLE_ENTITIES = ['site', 'cabinet', 'device_type', 'vendor'] as const;

export interface SiteRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  active: boolean;
}

export interface CabinetRow {
  id: string;
  siteId: string;
  siteCode: string;
  code: string;
  description: string | null;
  uHeight: number | null;
  active: boolean;
}

export interface DeviceTypeRow {
  id: string;
  name: string;
  hasPortMap: boolean;
  description: string | null;
  active: boolean;
}

export interface VendorRow {
  id: string;
  name: string;
  supplies: string | null;
  phone: string | null;
  contact: string | null;
  active: boolean;
}

/** Bộ phận / phòng ban (0028) — nguồn gợi ý cho mọi ô "ai đang dùng". */
export interface DepartmentRow {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
}

/** Nhà mạng (0028). */
export interface IspProviderRow {
  id: string;
  name: string;
  hotline: string | null;
  contact: string | null;
  active: boolean;
}

export const SERVICE_PROTOCOLS = ['tcp', 'udp', 'both'] as const;
export type ServiceProtocol = (typeof SERVICE_PROTOCOLS)[number];

/** Dịch vụ / port (0028) — khai một lần rồi chọn lại ở sổ NAT. */
export interface ServicePortRow {
  id: string;
  name: string;
  protocol: ServiceProtocol;
  portFrom: number;
  portTo: number;
  description: string | null;
  active: boolean;
}

export type CatalogRow =
  | SiteRow
  | CabinetRow
  | DeviceTypeRow
  | VendorRow
  | DepartmentRow
  | IspProviderRow
  | ServicePortRow;

export interface CatalogLists {
  sites: SiteRow[];
  cabinets: CabinetRow[];
  deviceTypes: DeviceTypeRow[];
  vendors: VendorRow[];
  departments: DepartmentRow[];
  ispProviders: IspProviderRow[];
  servicePorts: ServicePortRow[];
}

/** "443" hoặc "50000-52000" — một dải một port thì chỉ hiện một số. */
export function portRangeLabel(row: ServicePortRow): string {
  return row.portFrom === row.portTo ? String(row.portFrom) : `${row.portFrom}-${row.portTo}`;
}

/** Nhãn hiển thị của một mục — dùng ở hộp xác nhận và bảng lịch sử. */
export function catalogLabel(entity: CatalogEntity, row: CatalogRow): string {
  if (entity === 'site') return (row as SiteRow).code;
  if (entity === 'cabinet') {
    const cabinet = row as CabinetRow;
    return `${cabinet.siteCode} · ${cabinet.code}`;
  }
  return (row as DeviceTypeRow | VendorRow).name;
}
