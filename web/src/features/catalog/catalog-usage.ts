import { PATHS } from '@/lib/routes';
import type { CabinetRow, CatalogEntity, CatalogRow, CatalogUsage } from '@/lib/catalog-types';

export interface UsageLink {
  kind: string;
  count: number;
  /** `null` khi màn đích chưa lọc được theo loại mục này — con số vẫn hiện, chỉ không bấm được. */
  href: string | null;
}

/** Bộ lọc thiết bị ứng với một mục danh mục — `null` khi màn Thiết bị không lọc theo loại này. */
export function devicesFilterOf(entity: CatalogEntity, row: CatalogRow): string | null {
  if (entity === 'site') return `siteId=${row.id}`;
  if (entity === 'cabinet') return `siteId=${(row as CabinetRow).siteId}&cabinetId=${row.id}`;
  if (entity === 'device_type') return `deviceTypeId=${row.id}`;
  return null;
}

/**
 * Link "danh sách lọc sẵn" cho từng con số. Màn đích mặc định ẩn hồ sơ đã thanh lý thì thêm
 * `status=all`: con số đếm CẢ hồ sơ đó (khóa ngoại vẫn chặn xóa), bấm vào mà ra ít hơn là
 * người đọc mất lòng tin vào con số.
 */
function hrefOf(entity: CatalogEntity, row: CatalogRow, kind: string): string | null {
  const id = encodeURIComponent(row.id);
  switch (kind) {
    case 'device': {
      const filter = devicesFilterOf(entity, row);
      return filter ? `${PATHS.devices}?${filter}` : null;
    }
    case 'software':
      return entity === 'vendor' ? `${PATHS.software}?vendorId=${id}&status=all` : null;
    case 'cabinet':
      return entity === 'site' ? `${PATHS.adminCatalog}?tab=cabinet&siteId=${id}` : null;
    case 'isp_line':
      if (entity === 'site') return `${PATHS.ispLines}?siteId=${id}&status=all`;
      if (entity === 'isp_provider') return `${PATHS.ispLines}?providerId=${id}&status=all`;
      return null;
    default:
      return null;
  }
}

export function usageLinks(entity: CatalogEntity, row: CatalogRow): UsageLink[] {
  return (row.usage ?? [])
    .filter((item: CatalogUsage) => item.count > 0)
    .map((item: CatalogUsage) => ({ ...item, href: hrefOf(entity, row, item.kind) }));
}

/** Tổng số hồ sơ đang trỏ tới mục — > 0 thì Xóa chắc chắn bị khóa ngoại chặn. */
export function usageTotal(row: CatalogRow): number {
  return (row.usage ?? []).reduce((sum, item) => sum + item.count, 0);
}

/** Số thiết bị đang dùng mục (vd loại thiết bị) — 0 khi không có. */
export function deviceUsage(row: CatalogRow | null | undefined): number {
  return row?.usage?.find((item) => item.kind === 'device')?.count ?? 0;
}
