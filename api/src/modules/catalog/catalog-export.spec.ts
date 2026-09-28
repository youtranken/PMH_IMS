import { CATALOG_ENTITIES } from './catalog.types';
import { catalogExportColumns } from './catalog-export';

/** File xuất danh mục đọc giống bảng trên màn: đúng tiêu đề cột, giá trị người đọc được. */
describe('catalogExportColumns', () => {
  it.each([
    ['isp_provider', ['Tên', 'Hotline', 'Email / người liên hệ', 'Trạng thái']],
    ['vendor', ['Tên', 'Cung cấp gì', 'Điện thoại', 'Email / người liên hệ', 'Trạng thái']],
    ['service_port', ['Tên', 'Giao thức', 'Port', 'Mô tả', 'Trạng thái']],
  ] as const)('%s có đúng bộ cột của bảng', (entity, headers) => {
    expect(catalogExportColumns(entity).map((c) => c.header)).toEqual(headers);
  });

  it('mọi danh mục đều có bộ cột và cột cuối là Trạng thái', () => {
    for (const entity of CATALOG_ENTITIES) {
      const cols = catalogExportColumns(entity);
      expect(cols.at(-1)?.header).toBe('Trạng thái');
    }
  });

  it('giá trị đọc được: dải port, giao thức, cờ Có/Không, trạng thái', () => {
    const port = catalogExportColumns('service_port');
    const row = {
      id: 'x',
      name: 'Camera',
      protocol: 'both',
      portFrom: 50000,
      portTo: 52000,
      description: null,
      active: false,
    } as never;
    expect(port.map((c) => c.value(row))).toEqual(['Camera', 'TCP + UDP', '50000-52000', '', 'Đã vô hiệu hóa']);
    const type = catalogExportColumns('device_type');
    const t = { id: 'y', name: 'Switch', hasPortMap: true, isRouter: false, description: '', active: true } as never;
    expect(type.map((c) => c.value(t))).toEqual(['Switch', 'Có', 'Không', '', 'Đang dùng']);
  });
});
