import { describe, it, expect, vi } from 'vitest';
import {
  apiFetch,
  ApiError,
  makeQueryClient,
  queryClient,
  shouldRetryQuery,
} from '@/lib/api-client';
import { ME_KEY } from '@/lib/me';
import { clearNextPath, noteTabOwner, peekNextPath } from '@/lib/next-path';
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

  it('phiên chết giữa chừng → nhớ trang đang làm KÈM email chủ phiên, người khác không lấy được', async () => {
    queryClient.setQueryData(ME_KEY, { email: 'a@pmh.com.vn' });
    vi.stubGlobal('location', {
      href: '',
      pathname: '/approvals/7',
      search: '',
      hash: '',
    } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(apiFetch('/api/v1/accounts')).rejects.toMatchObject({ status: 401 });
    expect(peekNextPath('b@pmh.com.vn')).toBeNull();
    expect(peekNextPath('a@pmh.com.vn')).toBe('/approvals/7');
    clearNextPath();
    queryClient.clear();
  });

  it('cache `me` đã rỗng (F5 sau khi phiên chết) → chủ lấy từ tab, vẫn không trao cho người khác', async () => {
    noteTabOwner('a@pmh.com.vn');
    vi.stubGlobal('location', {
      href: '',
      pathname: '/devices/9',
      search: '?tab=vault',
      hash: '',
    } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(apiFetch('/api/v1/devices/9')).rejects.toMatchObject({ status: 401 });
    expect(peekNextPath('b@pmh.com.vn')).toBeNull();
    expect(peekNextPath('a@pmh.com.vn')).toBe('/devices/9?tab=vault');
    clearNextPath();
    noteTabOwner(null);
  });

  it('401 vì PHIÊN CHẾT → đá về màn đăng nhập', async () => {
    vi.stubGlobal('location', { href: '' } as unknown as Location);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(401, { code: 'SESSION_EXPIRED', message: 'Hết hạn' })),
    );
    await expect(apiFetch('/api/v1/accounts')).rejects.toMatchObject({ status: 401 });
    expect(window.location.href).toBe('/login');
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

describe('shouldRetryQuery — chỉ thử lại lỗi mạng và 5xx', () => {
  it.each([
    [new ApiError(400, null), false],
    [new ApiError(403, null), false],
    [new ApiError(404, null), false],
    [new ApiError(409, null), false],
    [new ApiError(500, null), true],
    [new ApiError(503, null), true],
    [new TypeError('Failed to fetch'), true],
  ])('lần hỏng đầu: %s → thử lại = %s', (error, expected) => {
    expect(shouldRetryQuery(0, error)).toBe(expected);
  });

  it('thử lại tối đa một lần', () => {
    expect(shouldRetryQuery(1, new ApiError(500, null))).toBe(false);
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('queryClient mặc định dùng đúng hàm này', () => {
    expect(makeQueryClient().getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
  });
});
