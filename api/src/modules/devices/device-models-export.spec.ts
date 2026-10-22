import { PATH_METADATA } from '@nestjs/common/constants';
import ExcelJS from 'exceljs';
import { ExcelExportService } from '../../common/excel/excel-export.service';
import { AUDITED_KEY } from '../audit/audited.decorator';
import { ROLES_KEY } from '../auth/roles.decorator';
import { DeviceModelsController } from './device-models.controller';

/** UX-E30: tab Model của Danh mục xuất được Excel — đúng bộ lọc đang xem, cột như bảng. */
describe('GET /device-models/export.xlsx', () => {
  const ITEM = {
    id: 'm1',
    deviceTypeId: 't1',
    deviceTypeName: 'Switch',
    model: 'C9200-24P',
    manufacturer: 'Cisco',
    rackMountable: true,
    uSize: 1,
    photoFrontFileId: null,
    portTemplate: [],
    portCount: 28,
    deviceCount: 4,
    unlinkedCount: 1,
    updatedAt: new Date(),
  };

  it('xuất đúng bộ lọc; cột Loại · Hãng · Model · Gắn tủ · Số U · Số cổng · Số máy; ảnh có hay không', async () => {
    const listAll = jest.fn().mockResolvedValue([ITEM]);
    const controller = new DeviceModelsController({ listAll } as never, {} as never, new ExcelExportService());
    const res = { setHeader: jest.fn(), end: jest.fn() };
    await controller.exportModels({ search: 'C92', deviceTypeId: undefined, manufacturer: 'Cisco' }, res as never);
    expect(listAll).toHaveBeenCalledWith({ search: 'C92', deviceTypeId: undefined, manufacturer: 'Cisco' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.end.mock.calls[0][0] as never);
    const sheet = wb.worksheets[0];
    expect(sheet.name).toBe('Model thiết bị');
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(['Loại', 'Hãng', 'Model', 'Gắn tủ', 'Số U', 'Số cổng', 'Số máy', 'Có ảnh']);
    expect((sheet.getRow(2).values as unknown[]).slice(1)).toEqual(['Switch', 'Cisco', 'C9200-24P', 'Có', 1, 28, 4, 'Không']);
  });

  it('mọi vai xuất được; lượt xuất ghi nhật ký', () => {
    const handler = (DeviceModelsController.prototype as unknown as Record<string, object>).exportModels;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('export.xlsx');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['sa', 'admin', 'member']);
    expect(Reflect.getMetadata(AUDITED_KEY, handler)).toMatchObject({ action: 'device_model.exported' });
  });
});
