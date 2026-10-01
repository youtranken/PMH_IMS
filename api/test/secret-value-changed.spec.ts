import { randomUUID } from 'node:crypto';
import { runMigrations } from '../src/database/migration-runner';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { VaultService } from '../src/modules/vault/vault.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * "Giá trị đổi lần cuối lúc nào, ai đổi" tách khỏi `updated_at`.
 *
 * `updated_at` nhảy cả khi chỉ sửa ghi chú, nên một mật khẩu ba năm chưa đổi vẫn hiện "vừa cập
 * nhật". Hai cột mới chỉ đi theo lúc CẤT và lúc ĐỔI GIÁ TRỊ — sửa tên gọi/ghi chú không chạm.
 */

const TEST_TIMEOUT = 120_000;

describe('Két: mốc đổi giá trị (value_changed_at/by)', () => {
  let scratch: ScratchDb;
  let vault: VaultService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_secret_value_changed');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const crypto = {
      seal: () => ({
        ciphertext: Buffer.from('ct'),
        iv: Buffer.alloc(12, 1),
        tag: Buffer.alloc(16, 1),
        wrappedDek: Buffer.alloc(60, 1),
        keyVersion: 1,
      }),
    } as unknown as EnvelopeCryptoService;
    const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
    const owners = {
      assertExists: () => Promise.resolve(),
      assertUsableWithin: () => Promise.resolve(),
      ownerNote: () => Promise.resolve(null),
    } as unknown as OwnerExistsRegistry;
    vault = new VaultService(scratch.db, crypto, audit, owners);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  function create(actor: string) {
    return vault.create(actor, {
      ownerType: 'device',
      ownerId: randomUUID(),
      kind: 'password',
      label: `E2E admin ${randomUUID().slice(0, 6)}`,
      value: 'Cisco#Core2026!',
    });
  }

  async function backdate(id: string) {
    await scratch.pool.query(
      `UPDATE secret SET value_changed_at = now() - interval '400 days',
                         updated_at = now() - interval '400 days' WHERE id = $1`,
      [id],
    );
  }

  /*
   * Q-15: danh sách tài khoản dịch vụ hiện "Đổi lần cuối" của từng hồ sơ. Một hồ sơ nhiều ngăn
   * thì lấy ngăn CŨ NHẤT — đó là ngăn đang kéo hồ sơ về hạn đổi. Ngăn đã thu hồi không tính.
   */
  it('mốc đổi cũ nhất theo từng hồ sơ: lấy ngăn cũ nhất, bỏ ngăn đã thu hồi, đúng loại hồ sơ', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const make = (ownerType: 'service_account' | 'device', ownerId: string) =>
      vault.create('a@qa.test', {
        ownerType,
        ownerId,
        kind: 'password',
        label: `E2E sa ${randomUUID().slice(0, 6)}`,
        value: 'Svc#Acct2026!',
      });
    const oldA = await make('service_account', a);
    await make('service_account', a);
    await backdate(oldA.id);
    await make('service_account', b);
    const revokedB = await make('service_account', b);
    await backdate(revokedB.id);
    await vault.revoke('a@qa.test', revokedB.id);
    const otherType = await make('device', a);
    await backdate(otherType.id);

    const rows = await vault.oldestValueChangeByOwner('service_account');
    const byOwner = new Map(rows.map((r) => [r.ownerId, r.valueChangedAt]));
    expect(Date.now() - byOwner.get(a)!.getTime()).toBeGreaterThan(399 * 86_400_000);
    expect(Date.now() - byOwner.get(b)!.getTime()).toBeLessThan(60_000);
  });

  it('cất mới: mốc đổi giá trị = lúc cất, người đổi = người cất', async () => {
    const meta = await create('a@qa.test');
    expect(meta.valueChangedBy).toBe('a@qa.test');
    expect(meta.valueChangedAt).toBeInstanceOf(Date);
  });

  it('sửa ghi chú KHÔNG làm giá trị trông như vừa đổi', async () => {
    const meta = await create('a@qa.test');
    await backdate(meta.id);
    const edited = await vault.updateMeta('b@qa.test', meta.id, { note: 'ghi chú mới' });
    expect(Date.now() - edited.updatedAt.getTime()).toBeLessThan(60_000);
    expect(Date.now() - edited.valueChangedAt.getTime()).toBeGreaterThan(399 * 86_400_000);
    expect(edited.valueChangedBy).toBe('a@qa.test');
  });

  it('đổi giá trị: mốc về hiện tại, người đổi là người vừa đổi', async () => {
    const meta = await create('a@qa.test');
    await backdate(meta.id);
    await vault.rotate('c@qa.test', meta.id, 'MoiHon#2026');
    const after = await vault.findMeta(meta.id);
    expect(Date.now() - after.valueChangedAt.getTime()).toBeLessThan(60_000);
    expect(after.valueChangedBy).toBe('c@qa.test');
  });
});
