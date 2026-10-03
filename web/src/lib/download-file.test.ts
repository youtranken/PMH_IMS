import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { downloadFile, postForDownload } from '@/lib/download-file';
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

describe('postForDownload — POST JSON kèm CSRF, nhận file về', () => {
  it('gửi đúng phương thức + thân + CSRF; STEPUP_REQUIRED thành ApiError để hộp hỏi mã bắt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram' }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await postForDownload('/api/v1/diagrams/d1/versions/v1/exports', { format: 'pdf' }, 'tok', 'ban-ve.pdf').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toMatchObject({ code: 'STEPUP_REQUIRED' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/diagrams/d1/versions/v1/exports');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"format":"pdf"}');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
  });
});
