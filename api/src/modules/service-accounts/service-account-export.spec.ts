import type { Response } from 'express';
import type { ExcelExportService } from '../../common/excel/excel-export.service';
import type { UsersApiService } from '../users/users.api';
import { ServiceAccountController } from './service-account.controller';
import type { ServiceAccountService } from './service-account.service';

describe('Xuất Excel tài khoản dịch vụ', () => {
  let captured: { header: string; value: (row: unknown) => unknown }[] = [];
  let filterSeen: unknown = null;
  const excel = {
    build: (params: { columns: typeof captured }) => {
      captured = params.columns;
      return Promise.resolve(Buffer.from('x'));
    },
  } as unknown as ExcelExportService;
  const accounts = {
    listAll: (filter: unknown) => {
      filterSeen = filter;
      return Promise.resolve([]);
    },
  } as unknown as ServiceAccountService;
  const res = { setHeader: () => undefined, end: () => undefined } as unknown as Response;

  it('có đủ cột người kiểm toán hỏi, và KHÔNG có cột mật khẩu nào (FR-026)', async () => {
    await new ServiceAccountController(accounts, excel, {} as UsersApiService).export(
      { kind: 'vpn', status: 'active' },
      res,
    );
    const headers = captured.map((column) => column.header);
    expect(headers).toEqual(
      expect.arrayContaining(['Mã', 'Loại', 'Tên đăng nhập', 'Phòng ban', 'Người phụ trách', 'Trạng thái']),
    );
    expect(headers.some((header) => /mật khẩu|password|secret/i.test(header))).toBe(false);
    // Xuất đúng bộ lọc đang xem (FR-028).
    expect(filterSeen).toEqual({ search: undefined, kind: 'vpn', status: 'active', anyIp: false });
    const kind = captured.find((column) => column.header === 'Loại')!;
    expect(kind.value({ kind: 'vpn' })).toBe('VPN');
    expect(kind.value({ kind: 'shared' })).toBe('Dùng chung');
  });
});
