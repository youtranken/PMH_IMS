/** Bốn loại mục danh mục — trùng `CatalogEntity` phía API, dùng làm đoạn đường dẫn. */
export const CATALOG_ENTITIES = ['site', 'cabinet', 'device_type', 'vendor'] as const;
export type CatalogEntity = (typeof CATALOG_ENTITIES)[number];

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

export type CatalogRow = SiteRow | CabinetRow | DeviceTypeRow | VendorRow;

export interface CatalogLists {
  sites: SiteRow[];
  cabinets: CabinetRow[];
  deviceTypes: DeviceTypeRow[];
  vendors: VendorRow[];
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
