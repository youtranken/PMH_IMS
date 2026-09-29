import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { uploadForDownload } from '@/lib/upload';
import { jsonResponse } from '@/test/test-utils';

const file = () => new File(['x'], 'danh-muc.xlsx');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('uploadForDownload — gửi file lên, lưu file trả về', () => {
  it('POST multipart kèm CSRF, lưu với tên server gửi', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['PK']), {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="dong-loi-danh-muc.xlsx"' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const created = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await uploadForDownload('/api/v1/catalog/import/errors', file(), 'tok', 'dong-loi.xlsx');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/catalog/import/errors');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
    expect(init.body).toBeInstanceOf(FormData);
    expect(click).toHaveBeenCalledOnce();
  });

  it('401 vì PHIÊN CHẾT → về màn đăng nhập, không lưu gì', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(
      uploadForDownload('/api/v1/x/import/errors', file(), 'tok', 'x.xlsx'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(window.location.href).toBe('/login');
  });
});
