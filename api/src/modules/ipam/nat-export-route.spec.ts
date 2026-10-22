import ExcelJS from 'exceljs';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { IpamController } from './ipam.controller';

/** UX-E29: route xuất Sổ NAT lọc theo đúng bộ lọc của màn và có ba cột kiểm toán. */
describe('GET /ipam/nat/export.xlsx', () => {
  const base = {
    id: 'r1',
    deviceId: 'd1',
    deviceCode: 'RT-E2E',
    deviceName: null,
    siteCode: 'HCM',
    protocol: 'tcp',
    externalFrom: 3389,
    externalTo: 3389,
    externalPorts: '3389',
    internalIp: '10.0.0.5',
    internalPort: 3389,
    internalOwner: null,
    usedBy: 'Kế toán',
    reason: 'RDP',
    enabled: true,
    note: 'Tạm 1 tuần',
    createdBy: 'an@pmh.com.vn',
    createdAt: new Date('2026-10-01T01:30:00Z'),
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };
  const rows = [base, { ...base, id: 'r2', externalFrom: 8080, externalTo: 8080, externalPorts: '8080', internalPort: 80, enabled: false, note: null }];

  function setup() {
    const list = jest.fn().mockResolvedValue(rows);
    const config = { getString: jest.fn((key: string) => Promise.resolve(key === 'natSensitivePorts' ? '22,3389' : 'Asia/Ho_Chi_Minh')) };
    const users = { namesByEmails: jest.fn().mockResolvedValue(new Map([['an@pmh.com.vn', 'Nguyễn An']])) };
    const controller = new IpamController({} as never, {} as never, { list } as never, new ExcelExportService(), {} as never, users as never, config as never);
    const res = { setHeader: jest.fn(), end: jest.fn() };
    return { controller, list, res };
  }

  async function sheetOf(res: { end: jest.Mock }) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.end.mock.calls[0][0] as never);
    return wb.worksheets[0];
  }

  it('chỉ cổng nhạy cảm + trạng thái đang mở: đúng một dòng; có Ghi chú, Mở lúc (giờ VN), Người mở', async () => {
    const { controller, list, res } = setup();
    await controller.exportNat({ states: 'open', sensitive: '1' }, res as never);
    expect(list.mock.calls[0][0]).toMatchObject({ includeVoided: false });
    const sheet = await sheetOf(res);
    const headers = (sheet.getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(expect.arrayContaining(['Ghi chú', 'Mở lúc', 'Người mở']));
    expect(sheet.rowCount).toBe(2);
    const row = sheet.getRow(2);
    const at = (name: string) => row.getCell(headers.indexOf(name) + 1).value;
    expect(at('Ghi chú')).toBe('Tạm 1 tuần');
    expect(at('Mở lúc')).toBe('01/10/2026 08:30');
    expect(at('Người mở')).toBe('Nguyễn An');
  });

  it('không gửi trạng thái → như cũ: mọi rule còn trong sổ (đang mở + đang tắt)', async () => {
    const { controller, res } = setup();
    await controller.exportNat({}, res as never);
    expect((await sheetOf(res)).rowCount).toBe(3);
  });

  it('có chip Đã gỡ → hỏi kèm rule đã gỡ', async () => {
    const { controller, list, res } = setup();
    await controller.exportNat({ states: 'open,voided' }, res as never);
    expect(list.mock.calls[0][0]).toMatchObject({ includeVoided: true });
  });
});
