import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * `/auth/me` hỏng KHÔNG có nghĩa là "chưa đăng nhập".
 *
 * API khởi động lại (nginx trả 502) hoặc mạng chập đúng lúc tải trang: người dùng có phiên
 * hợp lệ mà bị đẩy về màn đăng nhập thì họ đăng nhập lại cho một phiên vẫn còn sống — và nếu
 * API chưa lên thì màn đăng nhập cũng hỏng nốt. Đúng việc phải làm là nói "không tải được" và
 * cho một nút Thử lại.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Cổng phiên của App', () => {
  it('502 ở /auth/me → hiện lỗi kèm "Thử lại", KHÔNG về màn đăng nhập', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, null))
      .mockResolvedValue(jsonResponse(401, { code: 'UNAUTHENTICATED' }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithI18n(<App />);

    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('button', { name: 'Đăng nhập' })).not.toBeInTheDocument();

    // Thử lại thì hỏi lại /auth/me; lần này là 401 thật → màn đăng nhập.
    await userEvent.setup().click(retry);
    expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it('mất mạng (fetch ném lỗi) → cũng hiện "Thử lại"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderWithI18n(<App />);
    expect(await screen.findByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('401 thật ở /auth/me → vẫn về màn đăng nhập như cũ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { code: 'UNAUTHENTICATED' })));
    renderWithI18n(<App />);
    expect(await screen.findByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });
});
