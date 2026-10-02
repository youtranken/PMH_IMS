import { dtoErrorBody } from '../../test/dto-pipe';
import { DeviceExportQueryDto, DeviceListQueryDto } from './device-query.dto';

/*
 * `siteId` / `cabinetId` / `deviceTypeId` đi thẳng xuống `eq(...)`: chuỗi rác tới Postgres thành
 * 22P02 và bung 500. Bộ lọc sai dạng phải là 400 có câu tiếng Việt.
 */
const UUID = '0b7c6a43-4f1e-4d7e-9a43-2f6d1c1b9e10';
const UUID_2 = '7d1e2f30-1111-4c2b-8a00-000000000002';

describe('DeviceListQueryDto', () => {
  it('nhận đủ bộ lọc mà web đang gửi', async () => {
    expect(
      await dtoErrorBody(DeviceListQueryDto, {
        page: '1',
        limit: '20',
        search: 'SRV',
        siteId: UUID,
        cabinetId: UUID,
        deviceTypeId: UUID,
        deviceTypeIds: `${UUID},${UUID_2}`,
        status: 'live',
        usable: 'true',
        department: 'IT',
        assignedTo: 'Nguyễn Văn A',
        sort: 'code',
        dir: 'asc',
      }),
    ).toBeNull();
  });

  it('ô lọc để trống vẫn hợp lệ (web xoá bộ lọc)', async () => {
    expect(await dtoErrorBody(DeviceListQueryDto, { siteId: '', cabinetId: '' })).toBeNull();
  });

  it.each([
    ['siteId', 'abc'],
    ['cabinetId', '123'],
    ['deviceTypeId', 'not-a-uuid'],
  ])('%s rác → 400', async (field, value) => {
    const body = await dtoErrorBody(DeviceListQueryDto, { [field]: value });
    expect(body).not.toBeNull();
    expect(String(body?.message)).toMatch(/không hợp lệ/);
  });

  /* Q-20: tham số trạng thái lạ coi như bộ lọc mặc định — `?status=a&status=b` (mảng) cũng vậy,
     controller đọc qua `deviceStatusQuery` ra `live`. 400 thì cả màn thành trang lỗi. */
  it.each([DeviceListQueryDto, DeviceExportQueryDto])(
    '%p: status lặp (mảng) không 400 — về mặc định live',
    async (dto) => {
      expect(await dtoErrorBody(dto, { status: ['live', 'retired'] })).toBeNull();
    },
  );

  /* department / assignedTo là khớp ĐÚNG một giá trị: mảng không có nghĩa "một phòng", và bỏ
     qua thì trả về tập rộng hơn cái hộp gán license đã chọn. Giữ 400 như mọi query DTO chặt. */
  it.each(['department', 'assignedTo'])('%s lặp (mảng) → 400', async (field) => {
    expect(await dtoErrorBody(DeviceListQueryDto, { [field]: ['IT', 'KT'] })).not.toBeNull();
  });

  it('deviceTypeIds có một mục rác → 400, không lặng lẽ bỏ lọc', async () => {
    const body = await dtoErrorBody(DeviceListQueryDto, { deviceTypeIds: `${UUID},rac` });
    expect(body).not.toBeNull();
    expect(String(body?.message)).toMatch(/không hợp lệ/);
  });
});

describe('DeviceExportQueryDto', () => {
  it('siteId rác → 400', async () => {
    expect(await dtoErrorBody(DeviceExportQueryDto, { siteId: 'x' })).not.toBeNull();
  });

  it('bộ lọc hợp lệ đi qua', async () => {
    expect(
      await dtoErrorBody(DeviceExportQueryDto, { siteId: UUID, status: 'live', sort: 'code', dir: 'desc' }),
    ).toBeNull();
  });
});
