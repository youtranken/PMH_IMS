import { PATH_METADATA } from '@nestjs/common/constants';
import ExcelJS from 'exceljs';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { AUDITED_KEY } from '../audit/audited.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { VaultAccessController } from './vault-access.controller';

/**
 * UX-E28: rà soát quyền két định kỳ cần một file — mỗi lời gán một dòng: người, nhóm, tầng,
 * người gán, ngày gán. Chỉ CẤU HÌNH quyền, không có giá trị két nào.
 */
describe('GET /vault/access/export.xlsx', () => {
  const RULE = {
    id: 'a1',
    memberEmail: 'tv@pmh.com.vn',
    scopeType: 'device_site',
    scopeRef: 's1',
    scopeLabel: 'Thiết bị tại HCM',
    tier: 'needs_approval',
    grantedBy: 'sa@pmh.com.vn',
    note: 'Trực đêm',
    createdAt: new Date('2026-10-01T01:30:00Z'),
    updatedAt: new Date('2026-10-01T01:30:00Z'),
  };

  function setup() {
    const access = {
      list: jest.fn().mockResolvedValue([RULE]),
      people: jest.fn().mockResolvedValue([
        { id: 'u1', email: 'tv@pmh.com.vn', fullName: 'Thành Viên', role: 'member', status: 'active' },
        { id: 'u2', email: 'sa@pmh.com.vn', fullName: 'Super Admin', role: 'sa', status: 'active' },
      ]),
    };
    const config = { getString: jest.fn().mockResolvedValue('Asia/Ho_Chi_Minh') };
    const controller = new VaultAccessController(access as never, new ExcelExportService(), config as never);
    const res = { setHeader: jest.fn(), end: jest.fn() };
    return { controller, res };
  }

  it('một lời gán một dòng: người (họ tên + email), nhóm, tầng bằng chữ, người gán, ngày gán giờ VN', async () => {
    const { controller, res } = setup();
    await controller.exportAccess(res as never);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.end.mock.calls[0][0] as never);
    const sheet = wb.worksheets[0];
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(['Người', 'Email', 'Nhóm đối tượng', 'Tầng', 'Người gán', 'Ngày gán', 'Ghi chú']);
    expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual([
      'Thành Viên',
      'tv@pmh.com.vn',
      'Thiết bị tại HCM',
      'Cần duyệt',
      'Super Admin',
      '01/10/2026 08:30',
      'Trực đêm',
    ]);
  });

  it('chỉ SA/Admin; lượt xuất ghi nhật ký', () => {
    const handler = (VaultAccessController.prototype as unknown as Record<string, object>).exportAccess;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('export.xlsx');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['sa', 'admin']);
    expect(Reflect.getMetadata(AUDITED_KEY, handler)).toMatchObject({ action: 'vault.access.exported' });
  });
});
