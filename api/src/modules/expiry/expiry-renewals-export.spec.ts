import { BadRequestException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import ExcelJS from 'exceljs';
import { AUDITED_KEY } from '../audit/audited.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { ExpiryController } from './expiry.controller';
import type { ExpiryService } from './expiry.service';

/**
 * PW-A29: tab "Đã gia hạn" xuất được Excel — đúng khoảng ngày đang xem, cùng cột với màn
 * (hồ sơ, loại theo NHÃN, hạn cũ → mới, chi phí, hợp đồng, website, người làm theo họ tên).
 */
describe('GET /expiry/renewals/export.xlsx', () => {
  const ROW = {
    id: 'r1',
    objectKind: 'license',
    objectId: '00000000-0000-4000-8000-000000000001',
    label: 'Office E2E',
    oldEnd: '2026-01-01',
    newEnd: '2027-01-01',
    actor: 'an@pmh.com.vn',
    createdAt: new Date('2026-10-01T01:30:00Z'),
    contract: 'HĐ-01',
    cost: 1_200_000,
    websites: null,
  };

  function setup() {
    const recentRenewals = jest.fn().mockResolvedValue([ROW]);
    const expiry = {
      recentRenewals,
      kinds: () => [{ kind: 'license', label: 'License' }],
      timezone: jest.fn().mockResolvedValue('Asia/Ho_Chi_Minh'),
    } as unknown as ExpiryService;
    const users = { namesByEmails: jest.fn().mockResolvedValue(new Map([['an@pmh.com.vn', 'Nguyễn An']])) };
    const controller = new ExpiryController(expiry, {} as never, new ExcelExportService(), users as never);
    const res = { setHeader: jest.fn(), send: jest.fn(), end: jest.fn() };
    return { controller, recentRenewals, res };
  }

  async function sheetOf(res: { send: jest.Mock; end: jest.Mock }) {
    const buffer = (res.send.mock.calls[0] ?? res.end.mock.calls[0])[0] as Buffer;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as never);
    return wb.worksheets[0];
  }

  it('xuất đúng khoảng đang xem, cột như màn, loại theo nhãn, giờ Việt Nam, người theo họ tên', async () => {
    const { controller, recentRenewals, res } = setup();
    await controller.exportRenewals({ from: '2026-09-01', to: '2026-10-21' }, res as never);
    expect(recentRenewals).toHaveBeenCalledWith({ from: '2026-09-01', to: '2026-10-21' });
    const sheet = await sheetOf(res);
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      'Ngày gia hạn',
      'Hồ sơ',
      'Loại',
      'Hạn cũ',
      'Hạn mới',
      'Chi phí',
      'Hợp đồng',
      'Website',
      'Người làm',
    ]);
    const values = sheet.getRow(2).values as unknown[];
    expect(values.slice(1)).toEqual(['01/10/2026 08:30', 'Office E2E', 'License', '2026-01-01', '2027-01-01', 1_200_000, 'HĐ-01', '', 'Nguyễn An']);
  });

  it('"Đến ngày" trước "Từ ngày" → 400, không dựng file', async () => {
    const { controller, recentRenewals, res } = setup();
    await expect(controller.exportRenewals({ from: '2026-10-21', to: '2026-09-01' }, res as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(recentRenewals).not.toHaveBeenCalled();
  });

  it('mọi vai xuất được; lượt xuất ghi nhật ký', () => {
    const handler = (ExpiryController.prototype as unknown as Record<string, object>).exportRenewals;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('renewals/export.xlsx');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['sa', 'admin', 'member']);
    expect(Reflect.getMetadata(AUDITED_KEY, handler)).toMatchObject({ action: 'expiry.renewals_exported' });
  });
});
