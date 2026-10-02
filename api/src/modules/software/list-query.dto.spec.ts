import { dtoErrorBody } from '../../test/dto-pipe';
import { IspListQueryDto, SoftwareListQueryDto } from './list-query.dto';

// `vendorId`, `siteId`, `providerId` đi thẳng xuống `eq(...)`: chuỗi rác phải là 400, không 500.
const UUID = '0b7c6a43-4f1e-4d7e-9a43-2f6d1c1b9e10';

describe('SoftwareListQueryDto', () => {
  it('nhận đủ bộ lọc mà web đang gửi', async () => {
    expect(
      await dtoErrorBody(SoftwareListQueryDto, {
        page: '1',
        limit: '20',
        search: 'Office',
        kind: 'license',
        licenseModel: 'subscription',
        status: 'live',
        vendorId: UUID,
        sort: 'name',
        dir: 'asc',
      }),
    ).toBeNull();
  });

  it('kind nhận nhiều loại ngăn bằng dấu phẩy — màn Tên miền & SSL (Q-22)', async () => {
    expect(await dtoErrorBody(SoftwareListQueryDto, { kind: 'ssl,domain' })).toBeNull();
    expect(await dtoErrorBody(SoftwareListQueryDto, { kind: '' })).toBeNull();
  });

  it.each(['abc', 'ssl,abc', 'ssl,', 'ssl;domain'])('kind rác %p → 400', async (kind) => {
    const body = await dtoErrorBody(SoftwareListQueryDto, { kind });
    expect(String(body?.message)).toMatch(/không hợp lệ/);
  });

  it('vendorId rác → 400', async () => {
    const body = await dtoErrorBody(SoftwareListQueryDto, { vendorId: 'abc' });
    expect(String(body?.message)).toMatch(/không hợp lệ/);
  });
});

describe('IspListQueryDto', () => {
  it('nhận đủ bộ lọc mà web đang gửi', async () => {
    expect(
      await dtoErrorBody(IspListQueryDto, {
        page: '1',
        limit: '20',
        search: 'FPT',
        siteId: UUID,
        providerId: UUID,
        status: 'active,suspended',
        sort: 'code',
        dir: 'asc',
      }),
    ).toBeNull();
  });

  it.each([
    ['siteId', 'abc'],
    ['providerId', '42'],
  ])('%s rác → 400', async (field, value) => {
    const body = await dtoErrorBody(IspListQueryDto, { [field]: value });
    expect(String(body?.message)).toMatch(/không hợp lệ/);
  });
});
