import { planCatalogImport, type ParsedSheets } from './catalog-import';
import type { CatalogSnapshot } from './catalog.types';

/**
 * Q-19, SEC-21: cột Mô tả (tủ, loại thiết bị) và "Địa chỉ / ghi chú" của site trong file Excel
 * theo cùng luật với form — chuỗi trông như mật khẩu làm dòng đó thành lỗi, câu lỗi không nhắc
 * lại ô.
 */
function emptySnapshot(): CatalogSnapshot {
  return { sites: new Map(), cabinets: new Map(), deviceTypes: new Map(), vendors: new Map() };
}

function sheet(name: string, cells: Record<string, string>): ParsedSheets {
  return { [name]: [{ rowNumber: 2, cells }] };
}

const SECRET = 'Pmh@Guest2026';

describe('Nhập danh mục · ô chữ tự do không chứa mật khẩu (Q-19)', () => {
  it.each([
    ['Site', { 'Mã site *': 'E2E-S', 'Tên site *': 'Site', 'Địa chỉ / ghi chú': `wifi ${SECRET}` }, 'Địa chỉ'],
    [
      'Loại thiết bị',
      { 'Tên loại *': 'Switch E2E', 'Mô tả': `mk ${SECRET}` },
      'Mô tả',
    ],
  ])('sheet %s → dòng lỗi', (name, cells, column) => {
    const plan = planCatalogImport(sheet(name, cells), emptySnapshot());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain(column);
    expect(JSON.stringify(plan.rows[0])).not.toContain(SECRET);
  });

  it('mô tả tủ: cùng luật', () => {
    const plan = planCatalogImport(
      {
        Site: [{ rowNumber: 2, cells: { 'Mã site *': 'E2E-S', 'Tên site *': 'Site' } }],
        'Tủ mạng': [
          {
            rowNumber: 2,
            cells: { 'Mã tủ *': 'R01', 'Thuộc site *': 'E2E-S', 'Mô tả / vị trí': `mk ${SECRET}` },
          },
        ],
      },
      emptySnapshot(),
    );
    const cabinet = plan.rows.find((r) => r.sheet === 'cabinet');
    expect(cabinet?.action).toBe('error');
    expect(JSON.stringify(cabinet)).not.toContain(SECRET);
  });

  it('mô tả thường vẫn nhập được', () => {
    const plan = planCatalogImport(
      sheet('Loại thiết bị', { 'Tên loại *': 'Switch E2E', 'Mô tả': 'Cisco WS-C2960X-48FPD-L, 48 cổng PoE' }),
      emptySnapshot(),
    );
    expect(plan.rows[0].action).toBe('create');
  });
});
