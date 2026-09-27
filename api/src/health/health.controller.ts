import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import { Public } from '../modules/auth/public.decorator';
import { NoStepUp } from '../modules/auth/step-up.decorator';

const DB_TIMEOUT_MS = 2_000;

/**
 * Healthcheck của Docker và nginx (OPS-02). Kiểm database thật, có trần thời gian: DB treo thì
 * trả 503 nhanh chứ không để healthcheck treo theo. api không nói chuyện với Redis (mọi việc đi
 * qua outbox trong DB) — Redis do healthcheck của worker canh.
 */
@NoStepUp()
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string }> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.pool.query('SELECT 1'), timeout]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'down', component: 'database' });
    } finally {
      clearTimeout(timer);
    }
  }
}
