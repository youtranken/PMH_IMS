import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { CatalogBodyDto, CatalogController } from './catalog.controller';
import { DIAGRAM_SHAPES } from './diagram-shapes';

/**
 * Hình của loại thiết bị trên sơ đồ: chỉ chọn trong danh sách đóng, không ô
 * style tự do; chỉ SA tải/gỡ biểu tượng SVG riêng.
 */
describe('Danh mục loại thiết bị — hình trên sơ đồ mạng', () => {
  const errorsOf = (body: Record<string, unknown>) => validateSync(plainToInstance(CatalogBodyDto, body)).map((e) => e.property);

  it('nhận một hình trong danh sách, hoặc null (về "Thiết bị khác")', () => {
    expect(errorsOf({ diagramShape: DIAGRAM_SHAPES[0].key })).toEqual([]);
    expect(errorsOf({ diagramShape: null })).toEqual([]);
  });

  it.each([
    ['style tự do chèn ảnh ngoài', 'shape=image;image=https://evil.example/x.png'],
    ['hình draw.io không có trong danh sách', 'mxgraph.aws4.lambda'],
    ['chuỗi rỗng có dấu ;', ';'],
  ])('từ chối: %s', (_name, value) => {
    expect(errorsOf({ diagramShape: value })).toContain('diagramShape');
  });

  it('tên hình không chứa ký tự cắt được chuỗi style draw.io (khớp CHECK của migration 0047)', () => {
    for (const shape of DIAGRAM_SHAPES) expect(shape.key).toMatch(/^mxgraph\.[a-z0-9_]+(\.[a-z0-9_]+)+$/);
  });

  it.each(['setDiagramIcon', 'removeDiagramIcon'] as const)('%s chỉ SA (vai khác gọi → 403 ở RolesGuard)', (handler) => {
    const roles = Reflect.getMetadata(ROLES_KEY, Object.getOwnPropertyDescriptor(CatalogController.prototype, handler)!.value as object) as string[];
    expect(roles).toEqual(['sa']);
  });

  it('đọc danh sách hình / xem trước biểu tượng: mọi vai', () => {
    for (const handler of ['diagramShapes', 'diagramIcon'] as const) {
      const method = Object.getOwnPropertyDescriptor(CatalogController.prototype, handler)!.value as object;
      expect(Reflect.getMetadata(ROLES_KEY, method)).toEqual(['sa', 'admin', 'member']);
    }
  });
});
