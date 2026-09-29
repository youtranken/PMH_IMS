import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';

const SA = { role: 'sa' } as Me;

/** Nạp lại module với môi trường build giả lập — cờ được đọc MỘT lần lúc nạp. */
async function navWith(env: { DEV: boolean; VITE_DEV_KIT?: string }) {
  vi.resetModules();
  vi.stubEnv('DEV', env.DEV);
  vi.stubEnv('VITE_DEV_KIT', env.VITE_DEV_KIT ?? '');
  const nav = await import('./app-nav');
  return nav.visibleGroups(SA).flatMap((group) => group.items.map((item) => item.key));
}

describe('FE-09 — "Bộ giao diện" chỉ có ở stack dev/E2E', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('build production (không cờ): SA cũng không thấy mục, kể cả trong bảng lệnh', async () => {
    const keys = await navWith({ DEV: false });
    expect(keys).not.toContain('nav.components');
    expect(keys).toContain('nav.settings');
  });

  it('build có VITE_DEV_KIT=1 (override E2E): SA thấy mục', async () => {
    expect(await navWith({ DEV: false, VITE_DEV_KIT: '1' })).toContain('nav.components');
  });

  it('vite dev: có mục', async () => {
    expect(await navWith({ DEV: true })).toContain('nav.components');
  });
});
