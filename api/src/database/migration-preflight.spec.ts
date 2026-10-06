import type { PoolClient } from 'pg';
import { preflightMigration } from './migration-preflight';

function clientReturning(rows: { code: string; ips: string }[]): { client: PoolClient; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue({ rows, rowCount: rows.length });
  return { client: { query } as unknown as PoolClient, query };
}

describe('preflightMigration — 0037 một máy một IP (Q-20)', () => {
  it('không máy nào giữ hơn một IP → đi tiếp', async () => {
    await expect(preflightMigration(clientReturning([]).client, '0037_ip_one_per_device.sql')).resolves.toBeNull();
  });

  it('có máy giữ hơn một IP → câu chặn nêu tên máy, số đếm giữa câu viết thường như RUNBOOK (Q-24)', async () => {
    const message = await preflightMigration(
      clientReturning([{ code: 'PC-KT-01', ips: '10.0.0.5, 10.0.0.6' }]).client,
      '0037_ip_one_per_device.sql',
    );
    expect(message).toMatch(/^1 thiết bị đang giữ hơn một IP đang cấp \(PC-KT-01: 10\.0\.0\.5, 10\.0\.0\.6\)/);
  });

  it('file không có bước kiểm trước → null, không hỏi DB', async () => {
    const { client, query } = clientReturning([]);
    await expect(preflightMigration(client, '0001_app_role.sql')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
