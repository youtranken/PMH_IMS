import { describe, it, expect, vi } from 'vitest';
import { apiFetch, ApiError } from '@/lib/api-client';
import { jsonResponse } from '@/test/test-utils';

describe('apiFetch', () => {
  it('trả JSON khi ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { a: 1 })));
    await expect(apiFetch<{ a: number }>('/x')).resolves.toEqual({ a: 1 });
  });

  it('ném ApiError kèm status + body khi !ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, { message: 'trùng' })),
    );
    const err = (await apiFetch('/x').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.body).toEqual({ message: 'trùng' });
  });

  it('401 vì SAI THÔNG TIN NHẬP → ném lỗi tại chỗ, KHÔNG đá về màn đăng nhập', async () => {
    // Đây là lỗi từng làm màn đăng nhập không hiện được thông báo: apiFetch redirect
    // mọi 401 nên "sai mật khẩu" biến thành reload trang trắng.
    const assign = vi.fn();
    vi.stubGlobal('location', { href: '', assign } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'LOGIN_FAILED', message: 'Sai' })),
    );
    await expect(apiFetch('/api/v1/auth/login')).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe('');
  });

  it('401 vì PHIÊN CHẾT → đá về màn đăng nhập', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(apiFetch('/api/v1/accounts')).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe('/dang-nhap');
  });

  it('gắn Content-Type + X-CSRF-Token khi có body/csrf', async () => {
    const fn = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fn);
    await apiFetch('/x', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
      csrfToken: 'tok',
    });
    const init = fn.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-CSRF-Token']).toBe('tok');
  });
});
