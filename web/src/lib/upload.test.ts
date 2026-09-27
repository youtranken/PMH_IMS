import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { uploadFile } from '@/lib/upload';
import { jsonResponse } from '@/test/test-utils';

/**
 * `uploadFile` phải xử lý 401 Y HỆT `apiFetch`: phiên hết hạn giữa lúc chọn file và lúc bấm
 * Tải lên thì người dùng phải về màn đăng nhập, không phải nhận một toast "có lỗi xảy ra".
 */
const file = () => new File(['x'], 'danh-muc.xlsx');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uploadFile — dùng chung cách xử lý lỗi của apiFetch', () => {
  it('401 vì PHIÊN CHẾT → đá về màn đăng nhập', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(uploadFile('/api/v1/x/import', file(), 'tok')).rejects.toBeInstanceOf(ApiError);
    expect(window.location.href).toBe('/login');
  });

  it('401 cần gõ lại mã (STEPUP_REQUIRED) → KHÔNG đá về đăng nhập', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'STEPUP_REQUIRED', message: 'Nhập mã' })),
    );
    await expect(uploadFile('/api/v1/x/import', file(), 'tok')).rejects.toMatchObject({
      status: 401,
    });
    expect(window.location.href).toBe('');
  });

  it('lỗi khác (400) → ném ApiError kèm body, không chuyển trang', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { message: 'Sai mẫu' })));
    const err = (await uploadFile('/x', file(), 'tok').catch((e) => e)) as ApiError;
    expect(err.status).toBe(400);
    expect(err.body).toEqual({ message: 'Sai mẫu' });
    expect(window.location.href).toBe('');
  });
});
