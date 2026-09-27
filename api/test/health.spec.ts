import { ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
import { HealthController } from '../src/health/health.controller';
import { createScratchDb, type ScratchDb } from './db';

/**
 * OPS-02 — `/health` phải nói thật về database.
 *
 * Bản cũ trả cứng `{status:'ok'}`: DB chết thì healthcheck của Docker vẫn xanh, nginx vẫn chuyển
 * request vào một api chỉ trả 500, và không có gì kêu.
 */

const TEST_TIMEOUT = 120_000;

describe('OPS-02 · /health kiểm database thật', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_health');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('DB sống → ok', async () => {
    await expect(new HealthController(scratch.pool).check()).resolves.toEqual({ status: 'ok' });
  });

  it('DB không tới được → 503, không treo', async () => {
    const dead = new Pool({
      connectionString: 'postgresql://x:y@127.0.0.1:1/none',
      connectionTimeoutMillis: 500,
    });
    dead.on('error', () => undefined);
    const started = Date.now();
    await expect(new HealthController(dead).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    await dead.end();
  });
});
