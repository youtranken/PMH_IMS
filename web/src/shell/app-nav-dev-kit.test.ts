import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';

const SA = { role: 'sa' } as Me;

/** Nạp lại module với môi trường build giả lập — cờ được đọc MỘT lần lúc nạp. */
async function navWith(env: { DEV: boolean; VITE_DEV_KIT?: string }) {
  vi.resetModules();
  vi.stubEnv('DEV', env.DEV);
  vi.stubEnv('VITE_DEV_KIT', env.VITE_DEV_KIT ?? '');
  const nav = await import('./app-nav');
  return {
    keys: nav.visibleGroups(SA).flatMap((group) => group.items.map((item) => item.key)),
    groups: nav.visibleGroups(SA).map((group) => group.labelKey),
  };
}

/**
 * "Bộ giao diện" là trang nội bộ: không bao giờ có trên menu (Q-20), kể cả bản dev/E2E. Route
 * `/dev/components` vẫn còn ở bản dev/E2E (FE-09), vào bằng URL.
 */
describe('Q-20 — menu không có nhóm "Dành cho nhà phát triển"', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each([
    ['build production (không cờ)', { DEV: false }],
    ['build có VITE_DEV_KIT=1 (override E2E)', { DEV: false, VITE_DEV_KIT: '1' }],
    ['vite dev', { DEV: true }],
  ])('%s: SA không thấy mục Bộ giao diện', async (_name, env) => {
    const { keys, groups } = await navWith(env);
    expect(keys).not.toContain('nav.components');
    expect(groups).not.toContain('nav.groupDev');
    expect(keys).toContain('nav.settings');
  });
});
