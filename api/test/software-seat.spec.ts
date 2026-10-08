import { runMigrations } from '../src/database/migration-runner';
import { ExpirySourceRegistry } from '../src/common/expiry/expiry-registry';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { ExpiryDigestService } from '../src/modules/expiry/expiry-digest.service';
import { ExpiryApiService } from '../src/modules/expiry/expiry.api';
import { ExpiryService } from '../src/modules/expiry/expiry.service';
import { LicenseAssignmentService } from '../src/modules/software/license-assignment.service';
import { SoftwareService } from '../src/modules/software/software.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Ghế riêng của hồ sơ license (Q-27, migration 0065) trên Postgres thật.
 *
 * Bật "mỗi ghế có hợp đồng, giấy tờ, ghi chú riêng" thì hồ sơ có đúng `seat_total` hàng ghế; gán
 * máy là đưa máy vào một ghế trống. Hai thứ phải giữ bằng DB chứ không chỉ bằng service: một ghế
 * chỉ một máy đang giữ (index unique một phần), và bớt ghế không được bỏ mất ghế đang có máy.
 */
const TEST_TIMEOUT = 120_000;
const ACTOR = 'sa@pmh.com.vn';

describe('Ghế riêng của license (0065, Q-27)', () => {
  let scratch: ScratchDb;
  let software: SoftwareService;
  let seats: LicenseAssignmentService;
  let deviceIds: string[] = [];
  let round = 0;

  const seatRows = async (softwareId: string) =>
    (
      await scratch.pool.query<{ seat_no: number; contract: string | null; note: string | null }>(
        `SELECT seat_no, contract, note FROM software_seat WHERE software_id = $1 ORDER BY seat_no`,
        [softwareId],
      )
    ).rows;

  const newLicense = (seatTotal: number, extra: Record<string, unknown> = {}) => {
    round += 1;
    return software.create(ACTOR, {
      code: `LIC-E2E-GHE-${round}`,
      name: 'Windows Server 2025 E2E',
      kind: 'license',
      licenseModel: 'perpetual',
      seatTotal,
      ...extra,
    });
  };

  beforeAll(async () => {
    scratch = await createScratchDb('ims_software_seat');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const config = {
      getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
      getNumber: () => Promise.resolve(30),
    } as unknown as SystemConfigService;
    const catalog = {
      lists: () => Promise.resolve({ vendors: [] }),
      validateRefs: () => Promise.resolve([]),
      assertRefs: () => Promise.resolve(),
    } as unknown as CatalogApiService;
    const expiry = new ExpiryApiService(
      new ExpiryService(scratch.db, new ExpirySourceRegistry(), audit, config),
      {} as ExpiryDigestService,
    );
    software = new SoftwareService(scratch.db, catalog, audit, expiry, config);
    const devices = {
      assertUsableWithin: () => Promise.resolve(),
      getByIds: () => Promise.resolve(new Map()),
    } as unknown as DevicesApiService;
    seats = new LicenseAssignmentService(scratch.db, software, devices);

    const type = await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Server E2E GHE') RETURNING id`);
    const made = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id)
       VALUES ('SRV-E2E-GHE-1', 'A', $1), ('SRV-E2E-GHE-2', 'B', $1), ('SRV-E2E-GHE-3', 'C', $1)
       RETURNING id`,
      [type.rows[0].id],
    );
    deviceIds = made.rows.map((row) => row.id);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('tick + 3 ghế: có đủ ghế 1…3 với hợp đồng / ghi chú riêng; hợp đồng chung lưu ở hồ sơ khi không tick', async () => {
    const perSeat = await newLicense(3, {
      perSeat: true,
      seats: [
        { seatNo: 1, contract: 'PO-118-A', note: 'máy ảo ERP' },
        { seatNo: 3, contract: 'PO-121' },
      ],
    });
    expect(perSeat.perSeat).toBe(true);
    expect(await seatRows(perSeat.id)).toEqual([
      { seat_no: 1, contract: 'PO-118-A', note: 'máy ảo ERP' },
      { seat_no: 2, contract: null, note: null },
      { seat_no: 3, contract: 'PO-121', note: null },
    ]);

    const shared = await newLicense(2, { contract: 'PO-2026-140' });
    expect(shared).toMatchObject({ perSeat: false, contract: 'PO-2026-140' });
    expect(await seatRows(shared.id)).toEqual([]);
  });

  it('tick khi chỉ 1 ghế hoặc không giới hạn ghế → 400, không tạo gì', async () => {
    await expect(newLicense(1, { perSeat: true })).rejects.toMatchObject({ response: { code: 'SOFTWARE_INVALID' } });
    await expect(
      software.create(ACTOR, { code: 'LIC-E2E-GHE-VOHAN', name: 'X', kind: 'license', licenseModel: 'perpetual', seatTotal: null, perSeat: true }),
    ).rejects.toMatchObject({ response: { code: 'SOFTWARE_INVALID' } });
    const { rows } = await scratch.pool.query(`SELECT 1 FROM software WHERE code = 'LIC-E2E-GHE-VOHAN'`);
    expect(rows).toHaveLength(0);
  });

  it('DB cũng chặn: per_seat chỉ cho hồ sơ license', async () => {
    await expect(
      scratch.pool.query(`INSERT INTO software (code, name, kind, per_seat) VALUES ('DOM-E2E-GHE', 'x', 'domain', true)`),
    ).rejects.toThrow(/software_per_seat_license_check/);
  });

  it('gán máy: vào ghế trống theo thứ tự; chọn ghế đã có máy → 409; hết ghế thì vượt ghế như cũ (cần lý do, không vào ghế nào)', async () => {
    const lic = await newLicense(2, { perSeat: true });
    const first = await seats.assign(ACTOR, lic.id, { deviceId: deviceIds[0] });
    expect(first.assignment).toMatchObject({ seatNo: 1 });
    const seatTwo = (await software.detail(lic.id)).seats.find((seat) => seat.seatNo === 2);
    await expect(
      seats.assign(ACTOR, lic.id, { deviceId: deviceIds[1], seatId: (await software.detail(lic.id)).seats[0].id }),
    ).rejects.toMatchObject({ response: { code: 'SEAT_TAKEN' } });
    const second = await seats.assign(ACTOR, lic.id, { deviceId: deviceIds[1], seatId: seatTwo?.id });
    expect(second.assignment).toMatchObject({ seatNo: 2 });

    await expect(seats.assign(ACTOR, lic.id, { deviceId: deviceIds[2] })).rejects.toMatchObject({
      response: { code: 'SEAT_LIMIT_REACHED' },
    });
    const over = await seats.assign(ACTOR, lic.id, { deviceId: deviceIds[2], overSeatReason: 'chờ PO mua thêm' });
    expect(over.assignment).toMatchObject({ seatId: null, seatNo: null });

    // Gỡ máy thì ghế trống lại và nhận máy khác.
    await seats.release(ACTOR, lic.id, first.assignment.id);
    const detail = await software.detail(lic.id);
    expect(detail.seats.map((seat) => [seat.seatNo, seat.deviceId])).toEqual([
      [1, null],
      [2, deviceIds[1]],
    ]);
  });

  it('DB chặn hai máy cùng giữ một ghế dù đi vòng service', async () => {
    const lic = await newLicense(2, { perSeat: true });
    const [seat] = (await software.detail(lic.id)).seats;
    await scratch.pool.query(
      `INSERT INTO license_assignment (software_id, device_id, assigned_by, seat_id) VALUES ($1, $2, 'x', $3)`,
      [lic.id, deviceIds[0], seat.id],
    );
    await expect(
      scratch.pool.query(
        `INSERT INTO license_assignment (software_id, device_id, assigned_by, seat_id) VALUES ($1, $2, 'x', $3)`,
        [lic.id, deviceIds[1], seat.id],
      ),
    ).rejects.toThrow(/license_assignment_seat_live_key/);
  });

  it('bớt ghế: ghế trống cuối bị bỏ; ghế đang có máy thì không bớt được (409)', async () => {
    const lic = await newLicense(3, { perSeat: true });
    await seats.assign(ACTOR, lic.id, { deviceId: deviceIds[0] });
    await software.update(ACTOR, lic.id, { seatTotal: 2 });
    expect((await seatRows(lic.id)).map((row) => row.seat_no)).toEqual([1, 2]);

    const busy = await newLicense(3, { perSeat: true });
    const seatThree = (await software.detail(busy.id)).seats[2];
    await seats.assign(ACTOR, busy.id, { deviceId: deviceIds[1], seatId: seatThree.id });
    await expect(software.update(ACTOR, busy.id, { seatTotal: 2 })).rejects.toMatchObject({
      response: { code: 'SOFTWARE_SEATS_IN_USE' },
    });
    // Tắt ghế riêng thì số thứ tự ghế hết nghĩa: 1 máy / 1 ghế là hợp lệ, máy rời ghế, hàng ghế
    // giữ lại để bật lại không mất hợp đồng / giấy tờ đã khai.
    await software.update(ACTOR, busy.id, { seatTotal: 1, perSeat: false });
    const live = await scratch.pool.query(`SELECT seat_id FROM license_assignment WHERE software_id = $1 AND released_at IS NULL`, [busy.id]);
    expect(live.rows).toEqual([{ seat_id: null }]);
    expect((await seatRows(busy.id)).length).toBe(3);
  });

  it('bật ghế riêng cho hồ sơ đang có máy: máy đang dùng được xếp vào ghế trống theo thứ tự', async () => {
    const lic = await newLicense(3);
    await seats.assign(ACTOR, lic.id, { deviceId: deviceIds[0] });
    await seats.assign(ACTOR, lic.id, { deviceId: deviceIds[1] });
    await software.update(ACTOR, lic.id, { perSeat: true });
    const detail = await software.detail(lic.id);
    expect(detail.seats.map((seat) => seat.deviceId).filter(Boolean).sort()).toEqual([deviceIds[0], deviceIds[1]].sort());
    expect(detail.seats.find((seat) => seat.seatNo === 3)?.deviceId).toBeNull();
  });

  it('sửa ghế qua hồ sơ: đổi hợp đồng / ghi chú ghi lịch sử; tăng ghế thì thêm hàng', async () => {
    const lic = await newLicense(2, { perSeat: true });
    await software.update(ACTOR, lic.id, { seatTotal: 3, seats: [{ seatNo: 2, contract: 'PO-NEW', note: 'key dán thân máy' }] });
    expect(await seatRows(lic.id)).toEqual([
      { seat_no: 1, contract: null, note: null },
      { seat_no: 2, contract: 'PO-NEW', note: 'key dán thân máy' },
      { seat_no: 3, contract: null, note: null },
    ]);
    const history = await software.history(lic.id);
    expect(history.some((row) => row.action === 'seats-updated')).toBe(true);
  });

  it('giấy tờ gắn được vào ghế (owner_type software_seat)', async () => {
    const lic = await newLicense(2, { perSeat: true });
    const [seat] = (await software.detail(lic.id)).seats;
    const user = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash) VALUES ('e2e-ghe@qa.test', 'E2E', 'sa', 'x') RETURNING id`,
    );
    await scratch.pool.query(
      `INSERT INTO file (original_name, stored_name, mime_type, size_bytes, owner_type, owner_id, uploaded_by)
       VALUES ('OEM-ghe-1.pdf', 'e2e-ghe-1', 'application/pdf', 10, 'software_seat', $1, $2)`,
      [seat.id, user.rows[0].id],
    );
  });
});
