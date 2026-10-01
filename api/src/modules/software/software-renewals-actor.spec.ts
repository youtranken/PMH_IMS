import { SoftwareController } from './software.controller';
import type { SoftwareService } from './software.service';
import type { LicenseAssignmentService } from './license-assignment.service';
import type { ExcelExportService } from '../../common/excel/excel-export.service';
import type { UsersApiService } from '../users/users.api';
import type { SystemConfigService } from '../config-sys/system-config.service';

/*
 * Sổ gia hạn trên hồ sơ phần mềm và màn "Sắp hết hạn" phải gọi cùng một người bằng cùng một tên:
 * họ tên, email để làm chú thích. Màn này từng chỉ có email.
 */
describe('GET /software/:id/renewals — kèm họ tên người gia hạn', () => {
  it('tra họ tên qua users.api, không tra được thì actorName = null', async () => {
    const software = {
      renewals: () =>
        Promise.resolve([
          { id: 'r1', actor: 'A@pmh.com.vn', newEnd: '2027-01-01' },
          { id: 'r2', actor: 'nghi-viec@pmh.com.vn', newEnd: '2026-01-01' },
        ]),
    } as unknown as SoftwareService;
    const asked: string[][] = [];
    const users = {
      namesByEmails: (emails: string[]) => {
        asked.push(emails);
        return Promise.resolve(new Map([['a@pmh.com.vn', 'Nguyễn Văn A']]));
      },
    } as unknown as UsersApiService;
    const controller = new SoftwareController(
      software,
      {} as LicenseAssignmentService,
      {} as ExcelExportService,
      users,
      {} as SystemConfigService,
    );

    const rows = await controller.renewals({ id: '0b7c6a43-4f1e-4d7e-9a43-2f6d1c1b9e10' });
    expect(rows.map((r) => [r.actor, r.actorName])).toEqual([
      ['A@pmh.com.vn', 'Nguyễn Văn A'],
      ['nghi-viec@pmh.com.vn', null],
    ]);
    expect(asked).toHaveLength(1);
  });
});
