import {
  planDeviceImport,
  type DeviceImportContext,
  type ExistingDevice,
} from './device-import';
import type { ParsedSheets } from '../../common/import-plan';
import { deviceExportSheets } from './device-template';

const TYPE_SWITCH = { id: 'type-switch', name: 'Switch' };
const SITE_HO = { id: 'site-ho', code: 'PMH-HO' };
const CABINET_R01 = { id: 'cab-r01', code: 'R01', siteId: 'site-ho' };
const VENDOR_DELL = { id: 'vendor-dell', name: 'Dell Partner VN' };

function context(over: Partial<DeviceImportContext> = {}): DeviceImportContext {
  return {
    catalog: {
      sites: new Map([['pmh-ho', SITE_HO]]),
      cabinets: new Map([['pmh-ho r01', CABINET_R01]]),
      deviceTypes: new Map([['switch', TYPE_SWITCH]]),
      vendors: new Map([['dell partner vn', VENDOR_DELL]]),
    },
    devices: new Map(),
    ...over,
  };
}

function sheet(rows: Record<string, string>[]): ParsedSheets {
  return { 'Thiết bị': rows.map((cells, i) => ({ rowNumber: i + 2, cells })) };
}

const MINIMAL = {
  'Mã thiết bị *': 'SW-CORE-01',
  'Tên thiết bị *': 'Switch lõi',
  'Loại *': 'Switch',
};

function existing(over: Partial<ExistingDevice> = {}): ExistingDevice {
  return {
    id: 'dev-1',
    code: 'SW-CORE-01',
    name: 'Switch lõi',
    deviceTypeId: TYPE_SWITCH.id,
    model: null,
    serial: null,
    siteId: null,
    cabinetId: null,
    vendorId: null,
    assignedTo: null,
    department: null,
    purchaseDate: null,
    warrantyStart: null,
    warrantyEnd: null,
    status: 'in_use',
    note: null,
    ...over,
  };
}

describe('planDeviceImport — đối chiếu file thiết bị trước khi ghi (story 2.6)', () => {
  it('dòng đủ cột bắt buộc trên kho rỗng = thêm mới', () => {
    const plan = planDeviceImport(sheet([MINIMAL]), context());
    expect(plan.summary).toMatchObject({ create: 1, error: 0 });
    expect(plan.rows[0]).toMatchObject({ action: 'create', label: 'SW-CORE-01', rowNumber: 2 });
    expect(plan.rows[0].values).toMatchObject({
      code: 'SW-CORE-01',
      deviceTypeId: TYPE_SWITCH.id,
    });
    // File không có cột Trạng thái → không đụng tới trường đó (DB tự dùng mặc định in_use).
    expect(plan.rows[0].values).not.toHaveProperty('status');
  });

  it.each([
    ['Mã thiết bị *', 'Mã thiết bị'],
    ['Tên thiết bị *', 'Tên thiết bị'],
    ['Loại *', 'Loại'],
  ])('thiếu %s → lỗi nêu đúng tên cột', (column, label) => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, [column]: '' }]), context());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain(label);
  });

  it('loại thiết bị chưa có trong danh mục = lỗi, KHÔNG tự tạo (AC 2.6)', () => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, 'Loại *': 'Swich' }]), context());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Swich');
    expect(plan.rows[0].message).toContain('Danh mục');
  });

  it('site chưa có trong danh mục = lỗi nêu rõ mã site', () => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, Site: 'PMH-XX' }]), context());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('PMH-XX');
  });

  it('tủ thuộc site khác với site đã ghi = lỗi (bẫy hay gặp nhất khi import)', () => {
    const ctx = context();
    ctx.catalog.sites.set('pmh-nm', { id: 'site-nm', code: 'PMH-NM' });
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, Site: 'PMH-NM', 'Tủ mạng': 'R01' }]),
      ctx,
    );
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('R01');
  });

  it('ghi tủ mà bỏ trống site = lỗi, không đoán site giúp', () => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, Site: '', 'Tủ mạng': 'R01' }]), context());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Site');
  });

  it('site + tủ khớp nhau = thêm mới, tra đúng id', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, Site: 'pmh-ho', 'Tủ mạng': 'r01' }]),
      context(),
    );
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[0].values).toMatchObject({
      siteId: SITE_HO.id,
      cabinetId: CABINET_R01.id,
    });
  });

  it.each([
    ['Đang dùng', 'in_use'],
    ['dự phòng', 'spare'],
    ['HỎNG', 'broken'],
    ['Đã thanh lý', 'retired'],
  ])('trạng thái "%s" → %s', (input, expected) => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, 'Trạng thái': input }]), context());
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[0].values).toMatchObject({ status: expected });
  });

  /**
   * Ô Trạng thái để trống KHÔNG được ép về "Đang dùng": file sửa tay bỏ trống một ô sẽ
   * âm thầm hồi sinh thiết bị đã thanh lý và đẩy nó về lại danh sách nhắc bảo hành.
   */
  it('ô Trạng thái để trống = không đụng tới trạng thái đang có', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Trạng thái': '' }]),
      context({ devices: new Map([['sw-core-01', existing({ status: 'retired' })]]) }),
    );
    expect(plan.rows[0].values).not.toHaveProperty('status');
    expect(plan.summary).toMatchObject({ unchanged: 1, update: 0 });
  });

  /**
   * Máy ĐÃ THANH LÝ: hồ sơ khóa lại, và Excel không phải cửa sau.
   *
   * Import nằm ngay trong module `devices` nên không đi qua `DevicesApiService.assertUsable`
   * — hàng rào dựng ở cửa ngoài không với tới nó.
   */
  it('sửa hồ sơ máy đã thanh lý → dòng LỖI, không lặng lẽ ghi đè', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Tên thiết bị *': 'Ten moi de len ho so da khoa' }]),
      context({ devices: new Map([['sw-core-01', existing({ status: 'retired' })]]) }),
    );
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toMatch(/đã thanh lý/);
    expect(plan.summary).toMatchObject({ error: 1, update: 0 });
  });

  /**
   * Vế đối chứng, và là bài bắt được lỗi của chính bản vá đầu tiên.
   *
   * Bản đó chặn ngay khi thấy `status === 'retired'`, TRƯỚC khi biết dòng có đổi gì không.
   * Tải lại nguyên file kiểm kê — việc bình thường nhất của import — biến mọi máy đã thanh lý
   * thành dòng lỗi, và vì `commit` từ chối cả file khi còn lỗi thì cả lượt nhập đứng im.
   */
  it('dòng KHÔNG đổi gì trên máy đã thanh lý vẫn phải qua — nếu không, tải lại file kiểm kê là chết cả lượt', () => {
    const plan = planDeviceImport(
      sheet([MINIMAL]),
      context({ devices: new Map([['sw-core-01', existing({ status: 'retired' })]]) }),
    );
    expect(plan.rows[0].action).toBe('unchanged');
    expect(plan.summary).toMatchObject({ error: 0, unchanged: 1 });
  });

  /**
   * THANH LÝ BẰNG MỘT Ô EXCEL.
   *
   * `setStatus` hỏi máy còn giữ IP · rule NAT · ghế license nào, chặn nếu còn, và chỉ dọn khi
   * người dùng tick. Import gọi thẳng `updateWithin` nên đi vòng qua trọn vẹn cái chốt đó.
   */
  it('đổi trạng thái sang "Đã thanh lý" bằng Excel → dòng LỖI, thanh lý phải đi qua chốt', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Trạng thái': 'Đã thanh lý' }]),
      context({ devices: new Map([['sw-core-01', existing({ status: 'in_use' })]]) }),
    );
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toMatch(/bằng Excel.*nút "Thanh lý"/i);
  });

  /** Nhưng TẠO MỚI một máy đã thanh lý thì hợp lệ: nạp kho lịch sử lần đầu là việc thật. */
  it('tạo mới với trạng thái "Đã thanh lý" vẫn được — bản ghi mới chưa giữ gì để mà dọn', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Trạng thái': 'Đã thanh lý' }]),
      context(),
    );
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[0].values).toMatchObject({ status: 'retired' });
  });

  it('thiết bị MỚI mà bỏ trống Trạng thái thì để DB dùng mặc định', () => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, 'Trạng thái': '' }]), context());
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[0].values).not.toHaveProperty('status');
  });

  /**
   * File chỉ có cột Site (không có cột Tủ) mà đổi site thì
   * thiết bị giữ nguyên tủ của site CŨ — sai lặng lẽ, form nhập tay chặn còn import thì không.
   */
  it('đổi site mà giữ tủ của site cũ = lỗi, đúng như form nhập tay', () => {
    const ctx = context();
    ctx.catalog.sites.set('pmh-nm', { id: 'site-nm', code: 'PMH-NM' });
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, Site: 'PMH-NM' }]),
      {
        ...ctx,
        devices: new Map([
          ['sw-core-01', existing({ siteId: SITE_HO.id, cabinetId: CABINET_R01.id })],
        ]),
      },
    );
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('không thuộc site');
  });

  it('xóa site mà vẫn giữ tủ = lỗi, không để thiết bị có tủ mà không có site', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, Site: '' }]),
      context({
        devices: new Map([
          ['sw-core-01', existing({ siteId: SITE_HO.id, cabinetId: CABINET_R01.id })],
        ]),
      }),
    );
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Site');
  });

  /**
   * File chỉ sửa MỘT đầu ngày bảo hành vẫn có thể tạo ra khoảng ngược khi ghép với giá trị
   * đang có — không chặn ở đây thì nó lọt xuống DB và bung 500 không rõ dòng nào.
   */
  it('sửa một đầu ngày bảo hành thành khoảng ngược = lỗi ngay ở bảng đối chiếu', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Bảo hành đến': '01/01/2025' }]),
      context({
        devices: new Map([['sw-core-01', existing({ warrantyStart: '2026-01-01' })]]),
      }),
    );
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Bảo hành');
  });

  it('trạng thái lạ = lỗi kèm danh sách giá trị hợp lệ', () => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, 'Trạng thái': 'bỏ xó' }]), context());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Đang dùng');
  });

  it('ngày kiểu dd/mm/yyyy được nhận, chuẩn hóa về ISO', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Ngày mua': '15/03/2025', 'Bảo hành đến': '15/03/2028' }]),
      context(),
    );
    expect(plan.rows[0].values).toMatchObject({
      purchaseDate: '2025-03-15',
      warrantyEnd: '2028-03-15',
    });
  });

  it('ngày không đọc được = lỗi nêu rõ cột và giá trị', () => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, 'Ngày mua': 'tháng trước' }]), context());
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Ngày mua');
    expect(plan.rows[0].message).toContain('tháng trước');
  });

  it('bảo hành kết thúc trước khi bắt đầu = lỗi', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Bảo hành từ': '2027-01-01', 'Bảo hành đến': '2026-01-01' }]),
      context(),
    );
    expect(plan.rows[0].action).toBe('error');
    expect(plan.rows[0].message).toContain('Bảo hành');
  });

  it('trùng mã ngay trong file = lỗi ở dòng sau', () => {
    const plan = planDeviceImport(
      sheet([MINIMAL, { ...MINIMAL, 'Mã thiết bị *': 'sw-core-01' }]),
      context(),
    );
    expect(plan.rows[0].action).toBe('create');
    expect(plan.rows[1].action).toBe('error');
    expect(plan.rows[1].message).toContain('trùng');
  });

  it('mã đã có trong kho + đổi nội dung = CẬP NHẬT, không tạo bản sao', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Tên thiết bị *': 'Switch lõi (mới)' }]),
      context({ devices: new Map([['sw-core-01', existing()]]) }),
    );
    expect(plan.summary).toMatchObject({ update: 1, create: 0 });
    expect(plan.rows[0].existingId).toBe('dev-1');
  });

  it('mã đã có + nội dung y hệt = không đổi gì', () => {
    const plan = planDeviceImport(
      sheet([MINIMAL]),
      context({ devices: new Map([['sw-core-01', existing()]]) }),
    );
    expect(plan.summary).toMatchObject({ unchanged: 1, update: 0 });
  });

  it('dòng ví dụ trong file mẫu bị bỏ qua', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, 'Ghi chú nhập': 'VÍ DỤ' }]),
      context(),
    );
    expect(plan.summary).toMatchObject({ skip: 1, create: 0 });
  });

  it('dòng trắng bị bỏ qua, không tính là lỗi', () => {
    const plan = planDeviceImport(sheet([{ 'Mã thiết bị *': '', 'Tên thiết bị *': '  ' }]), context());
    expect(plan.rows).toHaveLength(0);
  });

  it('file không có sheet "Thiết bị" → plan rỗng để nơi gọi báo sai mẫu', () => {
    const plan = planDeviceImport({ Sheet1: [{ rowNumber: 2, cells: { a: 'b' } }] }, context());
    expect(plan.hasRecognizedSheet).toBe(false);
    expect(plan.rows).toHaveLength(0);
  });

  it('cột không có trong file thì KHÔNG bị xóa khi cập nhật', () => {
    const plan = planDeviceImport(
      // File chỉ có 3 cột bắt buộc — serial đang có trong kho phải giữ nguyên.
      sheet([MINIMAL]),
      context({ devices: new Map([['sw-core-01', existing({ serial: 'FOC123' })]]) }),
    );
    expect(plan.rows[0].values).not.toHaveProperty('serial');
    expect(plan.summary).toMatchObject({ unchanged: 1 });
  });

  it('cột có trong file nhưng bỏ trống = XÓA giá trị đang có', () => {
    const plan = planDeviceImport(
      sheet([{ ...MINIMAL, Serial: '' }]),
      context({ devices: new Map([['sw-core-01', existing({ serial: 'FOC123' })]]) }),
    );
    expect(plan.rows[0].values).toMatchObject({ serial: null });
    expect(plan.summary).toMatchObject({ update: 1 });
  });
});

describe('planDeviceImport — ô Excel không đọc được giá trị (BE-12)', () => {
  it('ô lỗi ở cột đang nhập → dòng lỗi, không xoá giá trị đang có', () => {
    const plan = planDeviceImport(
      {
        'Thiết bị': [
          {
            rowNumber: 5,
            cells: { ...MINIMAL, Serial: '' },
            unreadable: { Serial: 'ô đang báo lỗi #N/A' },
          },
        ],
      },
      context({ devices: new Map([['sw-core-01', existing({ serial: 'FOC123' })]]) }),
    );
    expect(plan.rows[0]).toMatchObject({ action: 'error', rowNumber: 5 });
    expect(plan.rows[0].message).toContain('Serial');
    expect(plan.rows[0].message).toContain('#N/A');
    expect(plan.summary).toMatchObject({ error: 1, update: 0 });
  });

  it('ô lỗi ở cột KHÔNG nhập (cột nháp của người dùng) thì bỏ qua', () => {
    const plan = planDeviceImport(
      {
        'Thiết bị': [
          { rowNumber: 2, cells: { ...MINIMAL, 'Cột nháp': '' }, unreadable: { 'Cột nháp': 'x' } },
        ],
      },
      context(),
    );
    expect(plan.rows[0]).toMatchObject({ action: 'create' });
  });
});

/*
 * Q-18: file mẫu ghi cột "Phòng ban sử dụng" (cùng nhãn với ô trên hồ sơ thiết bị); file cũ
 * còn cột "Bộ phận" vẫn phải nhập được.
 */
describe('planDeviceImport — cột phòng ban (Q-18)', () => {
  it('file mẫu/export ghi cột "Phòng ban sử dụng"', () => {
    const headers = deviceExportSheets([])[0].columns.map((c) => c.header);
    expect(headers).toContain('Phòng ban sử dụng');
    expect(headers.filter((h) => /bộ phận/i.test(h))).toEqual([]);
  });

  it.each(['Phòng ban sử dụng', 'Phòng ban', 'Bộ phận'])('cột "%s" nhập vào phòng ban', (column) => {
    const plan = planDeviceImport(sheet([{ ...MINIMAL, [column]: 'Kế toán' }]), context());
    expect(plan.rows[0]).toMatchObject({ action: 'create', values: { department: 'Kế toán' } });
  });
});
