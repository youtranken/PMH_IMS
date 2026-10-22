import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { runMigrations } from '../src/database/migration-runner';
import { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DeviceTypeOwnerResolver } from '../src/modules/catalog/device-type-owner-resolver';
import { DeviceTypePhotoService } from '../src/modules/catalog/device-type-photo.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { FilesApiService } from '../src/modules/files/files.api';
import { FilesService } from '../src/modules/files/files.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Biểu tượng + ảnh riêng của loại thiết bị (PW-A18, Q-33) trên Postgres thật + kho tệp thật:
 * loại có sẵn nhận biểu tượng hợp tên, biểu tượng chỉ nhận danh sách đóng, ảnh phải là ảnh đã tải
 * cho CHÍNH loại đó, ảnh bị thay thì vào thùng rác, mỗi lần đổi ghi lịch sử danh mục.
 */
const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-type-look@qa.test', role: 'sa' as const };

function png(size: number): Buffer {
  return new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}"/></svg>`)
    .render()
    .asPng();
}

describe('Danh mục · biểu tượng và ảnh của loại thiết bị', () => {
  let scratch: ScratchDb;
  let catalog: CatalogService;
  let photos: DeviceTypePhotoService;
  let files: FilesService;
  let dir: string;
  let uploader: string;
  let typeId: string;
  let otherTypeId: string;
  const previousDir = process.env.FILE_STORAGE_DIR;

  const upload = (ownerId: string, buffer: Buffer, name = 'anh.png') =>
    files.save({ buffer, originalName: name, ownerType: 'device_type', ownerId, uploadedBy: uploader, actor: SA.email, actorRole: 'sa' });
  const historyActions = async (id: string) =>
    (
      await scratch.pool.query<{ action: string }>(
        `SELECT action FROM catalog_history WHERE entity = 'device_type' AND entity_id = $1 ORDER BY created_at, id`,
        [id],
      )
    ).rows.map((r) => r.action);

  beforeAll(async () => {
    scratch = await createScratchDb('ims_device_type_look');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    dir = await mkdtemp(join(tmpdir(), 'ims-type-look-'));
    process.env.FILE_STORAGE_DIR = dir;
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    catalog = new CatalogService(db, audit);
    const owners = new OwnerExistsRegistry();
    new DeviceTypeOwnerResolver(owners, catalog).onModuleInit();
    files = new FilesService(db, audit, owners, new UsersApiService(new UsersService(db)), config, {
      register: () => undefined,
    } as unknown as SweepService);
    photos = new DeviceTypePhotoService(db, catalog, new FilesApiService(files), config);
    uploader = (
      await scratch.pool.query<{ id: string }>(
        `INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'E2E', 'sa', 'x') RETURNING id`,
        [SA.email],
      )
    ).rows[0].id;
    typeId = (await catalog.create(SA.email, 'device_type', { name: 'Máy E2E biểu tượng' })).id;
    otherTypeId = (await catalog.create(SA.email, 'device_type', { name: 'Máy E2E khác' })).id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    process.env.FILE_STORAGE_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('loại có sẵn nhận biểu tượng hợp tên; loại tự tạo để trống', async () => {
    const types = (await catalog.lists({ includeInactive: true })).deviceTypes;
    const icon = (name: string) => types.find((t) => t.name === name)?.icon;
    expect(icon('Switch')).toBe('switch');
    expect(icon('Laptop')).toBe('laptop');
    expect(icon('Thiết bị khác')).toBeNull();
    expect(icon('Máy E2E biểu tượng')).toBeNull();
  });

  it('biểu tượng chỉ nhận danh sách đóng; null = biểu tượng chung', async () => {
    await catalog.update(SA.email, 'device_type', typeId, { icon: 'router' });
    expect((await catalog.lists({ includeInactive: true })).deviceTypes.find((t) => t.id === typeId)?.icon).toBe('router');
    await expect(catalog.update(SA.email, 'device_type', typeId, { icon: 'khong-co' })).rejects.toMatchObject({
      response: { code: 'DEVICE_TYPE_ICON_INVALID' },
    });
    await catalog.update(SA.email, 'device_type', typeId, { icon: null });
    expect((await catalog.lists({ includeInactive: true })).deviceTypes.find((t) => t.id === typeId)?.icon).toBeNull();
  });

  it('ảnh phải là ảnh tải cho chính loại đó; thay ảnh thì ảnh cũ vào thùng rác; bỏ ảnh về biểu tượng', async () => {
    const foreign = await upload(otherTypeId, png(40));
    await expect(photos.setPhoto(SA.email, typeId, foreign.id)).rejects.toMatchObject({
      response: { code: 'DEVICE_TYPE_PHOTO_INVALID' },
    });

    const first = await upload(typeId, png(40));
    await photos.setPhoto(SA.email, typeId, first.id);
    expect((await photos.preview(typeId))?.mime).toBe('image/png');

    const second = await upload(typeId, png(60));
    await photos.setPhoto(SA.email, typeId, second.id);
    const alive = (await files.listFor('device_type', typeId)).map((f) => f.id);
    expect(alive).toEqual([second.id]);

    await photos.setPhoto(SA.email, typeId, null);
    expect(await photos.preview(typeId)).toBeNull();
    expect((await files.listFor('device_type', typeId)).map((f) => f.id)).toEqual([]);
    expect(await historyActions(typeId)).toEqual(
      expect.arrayContaining(['photo_set', 'photo_removed']),
    );
  });

  it('tệp không gắn được vào loại không có thật', async () => {
    await expect(upload('00000000-0000-4000-8000-000000000000', png(20))).rejects.toBeTruthy();
  });
});
