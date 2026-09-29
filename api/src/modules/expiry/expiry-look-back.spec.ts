import { ExpiryService } from './expiry.service';
import type { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { AuditWriterService } from '../audit/audit-writer.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { Database } from '../../database/database.module';

/**
 * BE-20 · màn "Sắp hết hạn" nhìn lùi bao xa đọc từ `expiry.look_back_days` (AD-11): đổi hàng
 * cấu hình là cửa sổ gửi xuống các nguồn hạn đổi theo.
 */

function serviceWith(lookBackDays: number, seen: { from: string; to: string }[]): ExpiryService {
  const registry = {
    collect: (from: string, to: string) => {
      seen.push({ from, to });
      return Promise.resolve({ items: [], failed: [] });
    },
    list: () => [],
  } as unknown as ExpirySourceRegistry;
  const numbers: Record<string, number> = {
    expiryCriticalDays: 7,
    expiryWarningDays: 30,
    expiryLookBackDays: lookBackDays,
  };
  const config = {
    getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    getNumber: (name: string) => Promise.resolve(numbers[name]),
  } as unknown as SystemConfigService;
  const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
  return new ExpiryService({} as Database, registry, audit, config);
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

describe('ExpiryService.list — cửa sổ nhìn lùi theo system_config', () => {
  it.each([
    [365, 365 + 30],
    [90, 90 + 30],
  ])('expiry.look_back_days = %i → cửa sổ từ-đến dài %i ngày', async (lookBack, span) => {
    const seen: { from: string; to: string }[] = [];
    await serviceWith(lookBack, seen).list({ withinDays: 30 });
    expect(daysBetween(seen[0].from, seen[0].to)).toBe(span);
  });
});
