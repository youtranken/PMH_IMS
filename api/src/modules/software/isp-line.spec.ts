import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { ExcelExportService } from '../../common/excel/excel-export.service';
import { messagesOf } from '../../common/validation-messages';
import { IspBodyDto, IspLineController } from './isp-line.controller';
import { ISP_SORT_KEYS, IspLineService } from './isp-line.service';
import { SoftwareExpiryRegistrar } from './software-expiry-sources';
import type { SoftwareService } from './software.service';
import type { UsersApiService } from '../users/users.api';
import type { CatalogApiService } from '../catalog/catalog.api';
import type { DevicesApiService } from '../devices/devices.api';

/**
 * Q-04 (`docs/QUYET-DINH.md`): đường truyền KHÔNG có hạn. Một line sống tới khi thanh lý, nên
 * nó không được xuất hiện ở bất kỳ cửa nào của cỗ máy hạn — màn Sắp hết hạn, mail tổng hợp,
 * khối hạn trên bảng điều khiển — và không có lối gia hạn.
 */
describe('Q-04 · đường truyền không có ngày kết thúc', () => {
  it('registry nhắc hạn không có nguồn ISP', () => {
    const registry = new ExpirySourceRegistry();
    new SoftwareExpiryRegistrar(registry, {} as SoftwareService).onModuleInit();

    const kinds = registry.list().map((source) => source.kind);
    expect(kinds).toEqual(['license', 'ssl', 'domain', 'maintenance', 'other']);
    expect(registry.find('isp')).toBeUndefined();
  });

  it('không còn route gia hạn, service không còn đường gia hạn hay quét hạn', () => {
    const proto = IspLineController.prototype as unknown as Record<string, unknown>;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((name) => typeof proto[name] === 'function' && name !== 'constructor')
      .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string | undefined);
    expect(paths).not.toContain(':id/renew');

    expect('renew' in IspLineService.prototype).toBe(false);
    expect('findExpiringBetween' in IspLineService.prototype).toBe(false);
  });

  it('không sắp được theo hạn — cột đó không còn trên màn', () => {
    expect(ISP_SORT_KEYS).not.toContain('endDate');
  });

  it('DTO từ chối `endDate` (400), các trường Q-04 giữ lại vẫn qua', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => new BadRequestException(messagesOf(errors)),
    });
    const run = (payload: Record<string, unknown>) =>
      pipe.transform(payload, { type: 'body', metatype: IspBodyDto });

    await expect(run({ code: 'FPT-01', endDate: '2027-01-01' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      run({
        code: 'FPT-01',
        providerId: '6f1c1e0a-3b7e-4a51-9a39-5d1c0f6b2a10',
        bandwidth: '300Mbps',
        wanIp: '203.0.113.10',
        hotline: '1900 6600',
        contractNo: 'HD-01',
        startDate: '2026-01-01',
        note: 'ghi chú',
        status: 'terminated',
      }),
    ).resolves.toBeDefined();
  });

  it('DTO nhận nhà mạng bằng id danh mục, từ chối tên gõ tay (Q-11)', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => new BadRequestException(messagesOf(errors)),
    });
    const run = (payload: Record<string, unknown>) =>
      pipe.transform(payload, { type: 'body', metatype: IspBodyDto });

    await expect(run({ code: 'FPT-01', provider: 'FPT' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(run({ code: 'FPT-01', providerId: 'FPT' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('file Excel không có cột hạn, và trạng thái cuối đọc là "Đã thanh lý" (Q-14)', async () => {
    let captured: { header: string; value: (row: unknown) => unknown }[] = [];
    const excel = {
      build: (params: { columns: typeof captured }) => {
        captured = params.columns;
        return Promise.resolve(Buffer.from('x'));
      },
    } as unknown as ExcelExportService;
    const isp = { listAll: () => Promise.resolve([]) } as unknown as IspLineService;
    const res = { setHeader: () => undefined, end: () => undefined } as unknown as Response;

    await new IspLineController(
      isp,
      excel,
      {} as UsersApiService,
      {} as DevicesApiService,
      {} as CatalogApiService,
    ).export({}, res);

    const headers = captured.map((column) => column.header);
    expect(headers).not.toContain('Hết hạn');
    // File xuất khớp bảng trên màn: có Site, thiết bị biên và ghi chú.
    expect(headers).toEqual(expect.arrayContaining(['Site', 'Thiết bị biên', 'Ghi chú']));
    const site = captured.find((column) => column.header === 'Site')!;
    expect(site.value({ siteCode: 'E2E-HCM' })).toBe('E2E-HCM');
    expect(site.value({ siteCode: null })).toBe('');
    const status = captured.find((column) => column.header === 'Trạng thái')!;
    expect(status.value({ status: 'terminated' })).toBe('Đã thanh lý');
    expect(status.value({ status: 'active' })).toBe('Đang dùng');
    expect(status.value({ status: 'suspended' })).toBe('Tạm ngưng');
  });
});
