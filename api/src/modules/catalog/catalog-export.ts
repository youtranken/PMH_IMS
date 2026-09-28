import type { ExportColumn } from '../../common/excel/excel-export.service';
import type { CatalogEntity, CatalogRecord } from './catalog.types';

type Row = CatalogRecord & Record<string, unknown>;

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const yesNo = (value: unknown): string => (value ? 'Có' : 'Không');
const status = (row: Row): string => (row.active ? 'Đang dùng' : 'Đã vô hiệu hóa');

/**
 * Cột của file "Xuất Excel" theo TỪNG danh mục — đúng bộ cột của bảng trên màn, để tờ in dán
 * phòng máy (nhà cung cấp + điện thoại, hotline nhà mạng) đọc giống hệt màn hình.
 *
 * Không phải file mẫu nhập: file mẫu (`catalog-template.ts`) có cột "Ghi chú nhập" và sheet
 * Hướng dẫn, và chỉ có bốn danh mục gốc.
 */
export function catalogExportColumns(entity: CatalogEntity): ExportColumn<Row>[] {
  const state: ExportColumn<Row> = { header: 'Trạng thái', width: 16, value: status };
  switch (entity) {
    case 'site':
      return [
        { header: 'Mã', width: 16, value: (r) => text(r.code) },
        { header: 'Tên', width: 30, value: (r) => text(r.name) },
        { header: 'Địa chỉ / ghi chú', width: 40, value: (r) => text(r.address) },
        state,
      ];
    case 'cabinet':
      return [
        { header: 'Mã', width: 18, value: (r) => text(r.code) },
        { header: 'Thuộc site', width: 16, value: (r) => text(r.siteCode) },
        { header: 'Mô tả', width: 40, value: (r) => text(r.description) },
        { header: 'Số U', width: 8, value: (r) => (typeof r.uHeight === 'number' ? r.uHeight : '') },
        state,
      ];
    case 'device_type':
      return [
        { header: 'Tên', width: 26, value: (r) => text(r.name) },
        { header: 'Có port map', width: 14, value: (r) => yesNo(r.hasPortMap) },
        { header: 'Router/Firewall', width: 16, value: (r) => yesNo(r.isRouter) },
        { header: 'Mô tả', width: 40, value: (r) => text(r.description) },
        state,
      ];
    case 'vendor':
      return [
        { header: 'Tên', width: 30, value: (r) => text(r.name) },
        { header: 'Cung cấp gì', width: 30, value: (r) => text(r.supplies) },
        { header: 'Điện thoại', width: 18, value: (r) => text(r.phone) },
        { header: 'Email / người liên hệ', width: 30, value: (r) => text(r.contact) },
        state,
      ];
    case 'department':
      return [
        { header: 'Tên', width: 30, value: (r) => text(r.name) },
        { header: 'Mô tả', width: 40, value: (r) => text(r.description) },
        state,
      ];
    case 'isp_provider':
      return [
        { header: 'Tên', width: 26, value: (r) => text(r.name) },
        { header: 'Hotline', width: 18, value: (r) => text(r.hotline) },
        { header: 'Email / người liên hệ', width: 30, value: (r) => text(r.contact) },
        state,
      ];
    case 'service_port':
      return [
        { header: 'Tên', width: 26, value: (r) => text(r.name) },
        {
          header: 'Giao thức',
          width: 12,
          value: (r) => (r.protocol === 'both' ? 'TCP + UDP' : text(r.protocol).toUpperCase()),
        },
        {
          header: 'Port',
          width: 14,
          value: (r) => (r.portTo && r.portTo !== r.portFrom ? `${text(r.portFrom)}-${text(r.portTo)}` : text(r.portFrom)),
        },
        { header: 'Mô tả', width: 40, value: (r) => text(r.description) },
        state,
      ];
  }
}

/** Tên sheet/tên file theo danh mục — không dấu, an toàn cho Excel (≤31 ký tự) và cho URL tải. */
export const CATALOG_EXPORT_NAME: Record<CatalogEntity, string> = {
  site: 'site',
  cabinet: 'tu-mang',
  device_type: 'loai-thiet-bi',
  vendor: 'nha-cung-cap',
  department: 'bo-phan',
  isp_provider: 'nha-mang',
  service_port: 'dich-vu-port',
};
