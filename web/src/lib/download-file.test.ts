import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { downloadFile } from '@/lib/download-file';
import { jsonResponse } from '@/test/test-utils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadFile — lỗi đi qua luật chung của apiFetch', () => {
  it('401 vì PHIÊN CHẾT → đá về màn đăng nhập', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(downloadFile('/api/v1/devices/export', 'thiet-bi.xlsx')).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(window.location.href).toBe('/login');
  });
});
