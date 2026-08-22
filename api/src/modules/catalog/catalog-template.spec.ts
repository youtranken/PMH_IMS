import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExcelImportService } from '../../common/excel/excel-import.service';
import { planCatalogImport } from './catalog-import';
import { catalogTemplateSheets, type CatalogTemplateData } from './catalog-template';
import type { CatalogSnapshot } from './catalog.types';

const now = new Date('2026-08-22T00:00:00Z');

const DEVICE_TYPES = [
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Switch',
    hasPortMap: true,
    description: 'Có port map',
    active: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    name: 'PC',
    hasPortMap: false,
    description: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  },
];

const EMPTY_CATALOG: CatalogTemplateData = {
  sites: [],
  cabinets: [],
  deviceTypes: DEVICE_TYPES,
  vendors: [],
};

function emptySnapshot(): CatalogSnapshot {
  return {
    sites: new Map(),
    cabinets: new Map(),
    deviceTypes: new Map(),
    vendors: new Map(),
  };
}

async function buildAndRead(data: CatalogTemplateData) {
  const buffer = await new ExcelExportService().buildWorkbook(catalogTemplateSheets(data));
  return new ExcelImportService().read(buffer);
}

/**
 * Vòng khép kín MẪU → ĐỌC LẠI. Đây là test giữ lời hứa với người dùng: "điền đúng file
 * chúng tôi phát ra thì import chạy". Đổi tiêu đề cột ở một bên mà quên bên kia là đỏ ngay.
 */
describe('File mẫu danh mục — sinh ra rồi đọc lại được (story 2.1)', () => {
  it('có đủ 5 sheet đúng tên', async () => {
    const sheets = await buildAndRead(EMPTY_CATALOG);
    expect(Object.keys(sheets)).toEqual([
      'Hướng dẫn',
      'Site',
      'Tủ mạng',
      'Loại thiết bị',
      'Nhà cung cấp',
    ]);
  });

  it('mọi dòng ví dụ trong mẫu trắng đều bị BỎ QUA, không tạo rác', async () => {
    const plan = planCatalogImport(await buildAndRead(EMPTY_CATALOG), emptySnapshot());
    expect(plan.hasRecognizedSheet).toBe(true);
    expect(plan.summary.error).toBe(0);
    // 12 loại thiết bị seed là dữ liệu THẬT (không đánh dấu ví dụ) nên vẫn được nhập;
    // site/tủ/NCC toàn dòng ví dụ nên bị bỏ qua sạch.
    expect(plan.summary.create).toBe(DEVICE_TYPES.length);
    expect(plan.summary.skip).toBeGreaterThan(0);
  });

  it('xuất danh mục ĐANG CÓ rồi nhập lại = không có gì thay đổi (idempotent)', async () => {
    const data: CatalogTemplateData = {
      sites: [
        {
          id: 's1',
          code: 'PMH-HO',
          name: 'Văn phòng chính',
          address: 'Tầng 1',
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      cabinets: [
        {
          id: 'c1',
          siteId: 's1',
          siteCode: 'PMH-HO',
          code: 'R01',
          description: 'Tủ mạng chính',
          uHeight: 42,
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      deviceTypes: DEVICE_TYPES,
      vendors: [
        {
          id: 'v1',
          name: 'Dell Partner VN',
          supplies: 'Máy chủ Dell',
          phone: '0909 111 222',
          contact: null,
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const snapshot: CatalogSnapshot = {
      sites: new Map([['pmh-ho', data.sites[0]]]),
      cabinets: new Map([['pmh-ho r01', data.cabinets[0]]]),
      deviceTypes: new Map(DEVICE_TYPES.map((t) => [t.name.toLowerCase(), t])),
      vendors: new Map([['dell partner vn', data.vendors[0]]]),
    };

    const plan = planCatalogImport(await buildAndRead(data), snapshot);
    expect(plan.summary).toMatchObject({ create: 0, update: 0, error: 0, skip: 0 });
    expect(plan.summary.unchanged).toBe(5);
  });

  it('số điện thoại bắt đầu bằng dấu + qua vòng xuất-nhập không bị thêm nháy đơn', async () => {
    const data: CatalogTemplateData = {
      ...EMPTY_CATALOG,
      vendors: [
        {
          id: 'v1',
          name: 'NCC quốc tế',
          supplies: null,
          phone: '+84901234567',
          contact: null,
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const sheets = await buildAndRead(data);
    expect(sheets['Nhà cung cấp'][0].cells['Điện thoại']).toBe('+84901234567');
  });
});
