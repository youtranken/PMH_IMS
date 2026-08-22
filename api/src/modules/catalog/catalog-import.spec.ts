import { planCatalogImport, type ParsedSheets } from './catalog-import';
import { normalizeKey } from '../../common/import-plan';
import type { CatalogSnapshot } from './catalog.types';

/** Ảnh chụp danh mục rỗng — mọi dòng hợp lệ đều là "thêm mới". */
function emptySnapshot(): CatalogSnapshot {
  return {
    sites: new Map(),
    cabinets: new Map(),
    deviceTypes: new Map(),
    vendors: new Map(),
  };
}

function snapshotWith(over: Partial<CatalogSnapshot>): CatalogSnapshot {
  return { ...emptySnapshot(), ...over };
}

const SITE_HO = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'PMH-HO',
  name: 'Văn phòng chính',
  address: 'Phòng máy chủ tầng 1',
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function sheet(name: string, rows: Record<string, string>[]): ParsedSheets {
  return {
    [name]: rows.map((cells, i) => ({ rowNumber: i + 2, cells })),
  };
}

describe('planCatalogImport — bảng đối chiếu trước khi ghi (story 2.1)', () => {
  it('dòng mới trên danh mục rỗng = thêm mới', () => {
    const plan = planCatalogImport(
      sheet('Site', [{ 'Mã site *': 'PMH-HO', 'Tên site *': 'Văn phòng chính' }]),
      emptySnapshot(),
    );
    expect(plan.summary).toMatchObject({ create: 1, update: 0, error: 0 });
    expect(plan.rows[0]).toMatchObject({
      sheet: 'site',
      rowNumber: 2,
      action: 'create',
      label: 'PMH-HO',
    });
  });

  it('trùng mã với mục đang có + đổi nội dung = CẬP NHẬT, không tạo bản sao', () => {
    const plan = planCatalogImport(
      sheet('Site', [{ 'Mã site *': 'pmh-ho', 'Tên site *': 'Văn phòng Quận 7' }]),
      snapshotWith({ sites: new Map([[normalizeKey('PMH-HO'), SITE_HO]]) }),
    );
    expect(plan.summary).toMatchObject({ create: 0, update: 1 });
    expect(plan.rows[0]).toMatchObject({ action: 'update', existingId: SITE_HO.id });
  });

  it('trùng mã nhưng nội dung y hệt = không đổi gì', () => {
    const plan = planCatalogImport(
      sheet('Site', [
        {
          'Mã site *': 'PMH-HO',
          'Tên site *': 'Văn phòng chính',
          'Địa chỉ / ghi chú': 'Phòng máy chủ tầng 1',
        },
      ]),
      snapshotWith({ sites: new Map([[normalizeKey('PMH-HO'), SITE_HO]]) }),
    );
    expect(plan.summary).toMatchObject({ unchanged: 1, update: 0, create: 0 });
  });

  it('bỏ qua dòng đánh dấu VÍ DỤ — người dùng không phải xóa tay', () => {
    const plan = planCatalogImport(
      sheet('Site', [
        { 'Mã site *': 'PMH-HO', 'Tên site *': 'Văn phòng chính', 'Ghi chú nhập': 'VÍ DỤ' },
      ]),
      emptySnapshot(),
    );
    expect(plan.summary).toMatchObject({ skip: 1, create: 0 });
    expect(plan.rows[0].action).toBe('skip');
  });

  it('thiếu cột bắt buộc = lỗi, nêu rõ thiếu cột nào', () => {
    const plan = planCatalogImport(
      sheet('Site', [{ 'Mã site *': '', 'Tên site *': 'Không có mã' }]),
      emptySnapshot(),
    );
    expect(plan.summary).toMatchObject({ error: 1 });
    expect(plan.rows[0].message).toContain('Mã site');
  });

  it('mã trùng nhau NGAY TRONG file = lỗi ở dòng sau', () => {
    const plan = planCatalogImport(
      sheet('Site', [
        { 'Mã site *': 'PMH-HO', 'Tên site *': 'Lần 1' },
        { 'Mã site *': 'pmh-ho', 'Tên site *': 'Lần 2' },
      ]),
      emptySnapshot(),
    );
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[1].action).toBe('error');
    expect(plan.rows[1].message).toContain('trùng');
  });

  it('tủ trỏ tới site không tồn tại = lỗi, không tự tạo site', () => {
    const plan = planCatalogImport(
      sheet('Tủ mạng', [{ 'Mã tủ *': 'R01', 'Thuộc site *': 'KHONG-CO' }]),
      emptySnapshot(),
    );
    expect(plan.summary).toMatchObject({ error: 1, create: 0 });
    expect(plan.rows[0].message).toContain('KHONG-CO');
  });

  it('tủ trỏ tới site được tạo NGAY TRONG cùng file = hợp lệ', () => {
    const plan = planCatalogImport(
      {
        ...sheet('Site', [{ 'Mã site *': 'PMH-NM', 'Tên site *': 'Nhà máy' }]),
        ...sheet('Tủ mạng', [{ 'Mã tủ *': 'RNM1', 'Thuộc site *': 'PMH-NM' }]),
      },
      emptySnapshot(),
    );
    expect(plan.summary).toMatchObject({ create: 2, error: 0 });
  });

  it('cùng mã tủ ở hai site khác nhau là hai tủ khác nhau', () => {
    const plan = planCatalogImport(
      {
        ...sheet('Site', [
          { 'Mã site *': 'PMH-HO', 'Tên site *': 'Văn phòng' },
          { 'Mã site *': 'PMH-NM', 'Tên site *': 'Nhà máy' },
        ]),
        ...sheet('Tủ mạng', [
          { 'Mã tủ *': 'R01', 'Thuộc site *': 'PMH-HO' },
          { 'Mã tủ *': 'R01', 'Thuộc site *': 'PMH-NM' },
        ]),
      },
      emptySnapshot(),
    );
    expect(plan.summary).toMatchObject({ create: 4, error: 0 });
  });

  it.each([
    ['Có', true],
    ['có', true],
    ['x', true],
    ['Yes', true],
    ['Không', false],
    ['', false],
  ])('cột "Có port map?" nhận "%s" → %s', (input, expected) => {
    const plan = planCatalogImport(
      sheet('Loại thiết bị', [{ 'Tên loại *': 'Switch', 'Có port map?': input }]),
      emptySnapshot(),
    );
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[0].values).toMatchObject({ hasPortMap: expected });
  });

  it.each([
    ['42', 42],
    ['', null],
    ['  24  ', 24],
  ])('cột "Số U" nhận "%s" → %s', (input, expected) => {
    const plan = planCatalogImport(
      {
        ...sheet('Site', [{ 'Mã site *': 'S1', 'Tên site *': 'Site 1' }]),
        ...sheet('Tủ mạng', [{ 'Mã tủ *': 'R01', 'Thuộc site *': 'S1', 'Số U': input }]),
      },
      emptySnapshot(),
    );
    const cabinet = plan.rows.find((r) => r.sheet === 'cabinet');
    expect(cabinet?.action).toBe('create');
    expect(cabinet?.values).toMatchObject({ uHeight: expected });
  });

  it('Số U không phải số = lỗi chứ không âm thầm thành 0', () => {
    const plan = planCatalogImport(
      {
        ...sheet('Site', [{ 'Mã site *': 'S1', 'Tên site *': 'Site 1' }]),
        ...sheet('Tủ mạng', [{ 'Mã tủ *': 'R01', 'Thuộc site *': 'S1', 'Số U': 'bốn hai' }]),
      },
      emptySnapshot(),
    );
    const cabinet = plan.rows.find((r) => r.sheet === 'cabinet');
    expect(cabinet?.action).toBe('error');
    expect(cabinet?.message).toContain('Số U');
  });

  it('tiêu đề cột thiếu dấu * hoặc khác hoa-thường vẫn nhận đúng', () => {
    const plan = planCatalogImport(
      sheet('Site', [{ 'mã site': 'PMH-HO', 'TÊN SITE': 'Văn phòng chính' }]),
      emptySnapshot(),
    );
    expect(plan.rows[0].action).toBe('create');
  });

  it('dòng trắng hoàn toàn bị bỏ qua, không tính là lỗi', () => {
    const plan = planCatalogImport(
      sheet('Site', [{ 'Mã site *': '', 'Tên site *': '', 'Địa chỉ / ghi chú': '  ' }]),
      emptySnapshot(),
    );
    expect(plan.rows).toHaveLength(0);
    expect(plan.summary).toMatchObject({ create: 0, error: 0, skip: 0 });
  });

  it('sheet lạ trong file bị bỏ qua, không làm hỏng cả lần import', () => {
    const plan = planCatalogImport(
      {
        ...sheet('Hướng dẫn', [{ 'Mục': 'Thứ tự làm' }]),
        ...sheet('Site', [{ 'Mã site *': 'PMH-HO', 'Tên site *': 'Văn phòng chính' }]),
      },
      emptySnapshot(),
    );
    expect(plan.summary).toMatchObject({ create: 1, error: 0 });
  });

  it('file không có sheet nào khớp = plan rỗng (nơi gọi báo "file sai mẫu")', () => {
    const plan = planCatalogImport(sheet('Sheet1', [{ a: 'b' }]), emptySnapshot());
    expect(plan.rows).toHaveLength(0);
    expect(plan.hasRecognizedSheet).toBe(false);
  });

  it('vendor trùng tên = cập nhật, khác tên = thêm mới', () => {
    const plan = planCatalogImport(
      sheet('Nhà cung cấp', [
        { 'Tên nhà cung cấp *': 'Dell Partner VN', 'Điện thoại': '0909 111 222' },
        { 'Tên nhà cung cấp *': 'NCC mới', 'Cung cấp gì': 'PC' },
      ]),
      snapshotWith({
        vendors: new Map([
          [
            normalizeKey('Dell Partner VN'),
            {
              id: '22222222-2222-2222-2222-222222222222',
              name: 'Dell Partner VN',
              supplies: null,
              phone: null,
              contact: null,
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        ]),
      }),
    );
    expect(plan.summary).toMatchObject({ update: 1, create: 1 });
  });
});
