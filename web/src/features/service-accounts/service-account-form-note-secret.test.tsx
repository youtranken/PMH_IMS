import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ServiceAccountForm } from './service-account-form';

/**
 * Ghi chú của hồ sơ tài khoản dịch vụ là cột RÕ (FR-035, Q-18). Hộp thêm mới vừa cất mật khẩu
 * vào két vừa lưu ghi chú, nên nó phải so hai ô trước khi gửi — cùng luật, cùng câu với két.
 */

function mockFetch() {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderForm() {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <ServiceAccountForm row={null} csrfToken="x" onClose={() => {}} onSaved={() => {}} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Hộp thêm tài khoản dịch vụ — ghi chú không được chứa mật khẩu', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ghi chú chứa mật khẩu đang cất: báo lỗi ở ô Ghi chú và KHÔNG gửi gì lên', async () => {
    const calls = mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Tên đăng nhập' }), 'ketoan');
    await user.type(screen.getByLabelText('Mật khẩu', { exact: true }), 'MatKhau#2026');
    await user.type(screen.getByRole('textbox', { name: /Ghi chú/ }), 'mk: matkhau # 2026');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    expect(
      await screen.findByText('Ghi chú đang chứa chính giá trị cần cất. Xóa nó khỏi ghi chú.'),
    ).toBeVisible();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('ghi chú bình thường: gửi hồ sơ như cũ', async () => {
    const calls = mockFetch();
    renderForm();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Tên đăng nhập' }), 'ketoan');
    await user.type(screen.getByLabelText('Mật khẩu', { exact: true }), 'MatKhau#2026');
    await user.type(screen.getByRole('textbox', { name: /Ghi chú/ }), 'Tài khoản chung kế toán');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await vi.waitFor(() =>
      expect(calls).toContainEqual({ url: '/api/v1/service-accounts', method: 'POST' }),
    );
  });

  it('ô mật khẩu là ô két dùng chung: che mặc định, có nút Hiện và Tạo ngẫu nhiên', async () => {
    mockFetch();
    renderForm();
    const user = userEvent.setup();
    const field = screen.getByLabelText('Mật khẩu', { exact: true });
    expect(field).toHaveAttribute('type', 'password');
    expect(field).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Tạo ngẫu nhiên' }));
    expect((field as HTMLInputElement).value.length).toBeGreaterThan(0);
    expect(field).toHaveAttribute('type', 'text');
  });
});
