import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { runMigrations } from '../src/database/migration-runner';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { EnvelopeCryptoService } from '../src/common/crypto/envelope.service';
import type { OwnerExistsRegistry } from '../src/common/owner-exists.registry';
import { VaultService } from '../src/modules/vault/vault.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Ghi chú của ngăn két không được chứa mật khẩu (Q-18, FR-035): server từ chối.
 *
 * Chạy trên Postgres thật để chứng minh hai điều mà test hàm thuần không nói được: bị từ chối
 * thì KHÔNG có hàng nào được ghi, và lỗi trả về không nhắc lại giá trị.
 */

const TEST_TIMEOUT = 120_000;
const VALUE = 'Cisco#Core2026!';

describe('Két: ghi chú không được chứa bí mật', () => {
  let scratch: ScratchDb;
  let vault: VaultService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_secret_note_guard');
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
    } as unknown as OwnerExistsRegistry;
    vault = new VaultService(scratch.db, crypto, audit, owners);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  function input(note: string | null, value = VALUE) {
    return {
      ownerType: 'device' as const,
      ownerId: randomUUID(),
      kind: 'password' as const,
      label: `E2E admin ${randomUUID().slice(0, 6)}`,
      note,
      value,
    };
  }

  /** Mã lỗi + chứng minh thân lỗi không mang giá trị bí mật đi đâu cả. */
  async function rejection(run: () => Promise<unknown>, secret: string): Promise<string> {
    const error = await run().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as { code: string; message: string };
    expect(JSON.stringify(body).toLowerCase()).not.toContain(secret.toLowerCase());
    return body.code;
  }

  async function countByOwner(ownerId: string): Promise<number> {
    const rows = await scratch.pool.query('SELECT 1 FROM secret WHERE owner_id = $1', [ownerId]);
    return rows.rowCount ?? 0;
  }

  it('cất mới: ghi chú chứa giá trị (khác hoa-thường, chèn dấu cách) bị từ chối, không ghi hàng nào', async () => {
    const data = input('mk là cisco # core2026! nhé');
    expect(await rejection(() => vault.create('a@qa.test', data), VALUE)).toBe(
      'NOTE_CONTAINS_SECRET',
    );
    expect(await countByOwner(data.ownerId)).toBe(0);
  });

  it('cất mới: ghi chú bình thường vẫn lưu', async () => {
    const meta = await vault.create('a@qa.test', input('Đổi theo chu kỳ 90 ngày'));
    expect(meta.note).toBe('Đổi theo chu kỳ 90 ngày');
  });

  it('cất mới: ghi chú có một từ trông như mật khẩu (khác giá trị) cũng bị từ chối', async () => {
    const data = input('mk cũ Admin@123456 nhé');
    expect(await rejection(() => vault.create('a@qa.test', data), 'Admin@123456')).toBe(
      'NOTE_LOOKS_LIKE_SECRET',
    );
    expect(await countByOwner(data.ownerId)).toBe(0);
  });

  it('sửa riêng ghi chú: trông như mật khẩu thì từ chối, ghi chú cũ giữ nguyên', async () => {
    const meta = await vault.create('a@qa.test', input('Đổi theo chu kỳ 90 ngày'));
    expect(
      await rejection(
        () => vault.updateMeta('b@qa.test', meta.id, { note: 'mới: Xk9#mP2vLq' }),
        'Xk9#mP2vLq',
      ),
    ).toBe('NOTE_LOOKS_LIKE_SECRET');
    expect((await vault.findMeta(meta.id)).note).toBe('Đổi theo chu kỳ 90 ngày');
  });

  it('sửa nhãn không gửi ghi chú: không kiểm ghi chú (không có gì mới để chặn)', async () => {
    const meta = await vault.create('a@qa.test', input(null));
    await scratch.pool.query(`UPDATE secret SET note = 'cũ Admin@123456' WHERE id = $1`, [
      meta.id,
    ]);
    const edited = await vault.updateMeta('b@qa.test', meta.id, { label: `E2E đổi ${meta.id.slice(0, 6)}` });
    expect(edited.label).toContain('E2E đổi');
  });

  it('đổi giá trị: giá trị MỚI trùng ghi chú đang có thì bị từ chối, giá trị cũ giữ nguyên', async () => {
    const meta = await vault.create('a@qa.test', input('mo cong 8443 truoc'));
    const next = 'mocong8443';
    expect(await rejection(() => vault.rotate('b@qa.test', meta.id, next), next)).toBe(
      'NOTE_CONTAINS_SECRET',
    );
    const after = await vault.findMeta(meta.id);
    expect(after.valueChangedBy).toBe('a@qa.test');
  });
});
