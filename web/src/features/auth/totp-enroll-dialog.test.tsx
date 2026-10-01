import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { TotpEnrollDialog } from './totp-enroll-dialog';

/**
 * Cài lại 2 lớp từ Hồ sơ (Q-20): nói TRƯỚC hệ quả (điện thoại cũ hết dùng, máy khác bị đăng
 * xuất), và bước hỏi mã của điện thoại ĐANG dùng nằm ngay trong hộp này — câu trên đó nói đúng
 * việc "cài lại", không phải câu chung "xem thông tin bí mật" của két.
 */

const WARNING =
  'Lưu ý: sau khi cài lại, mã trên điện thoại cũ không dùng được nữa; các máy khác đang đăng nhập sẽ bị đăng xuất.';
const PURPOSE = 'Nhập mã 6 số trên điện thoại ĐANG dùng để xác nhận cài lại xác thực 2 lớp.';

function renderDialog(mode: 'enable' | 'reenroll') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={qc}>
      <TotpEnrollDialog mode={mode} csrfToken="tok" onClose={vi.fn()} onDone={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('TotpEnrollDialog', () => {
  it('cài lại: hộp cảnh báo hiện ĐẦU TIÊN, trước ô mật khẩu', () => {
    renderDialog('reenroll');
    const dialog = screen.getByRole('dialog');
    const warning = within(dialog).getByText(WARNING);
    expect(warning.closest('.alert.warn')).not.toBeNull();
    const password = within(dialog).getByLabelText('Mật khẩu hiện tại');
    expect(warning.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('bật lần đầu: không có cảnh báo (chưa có điện thoại cũ nào)', () => {
    renderDialog('enable');
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('cài lại: server đòi mã → bước hỏi mã nằm TRONG hộp, câu nói đúng việc; gõ mã xong tự chạy lại', async () => {
    let reenrollCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/totp/re-enroll')) {
        reenrollCalls += 1;
        return Promise.resolve(
          reenrollCalls === 1
            ? jsonResponse(403, { code: 'STEPUP_REQUIRED', message: 'Cần mã' })
            : jsonResponse(200, { secret: 'JBSWY3DPEHPK3PXP', qrDataUrl: 'data:image/png,x', ticket: 't' }),
        );
      }
      if (url.endsWith('/api/v1/auth/step-up')) return Promise.resolve(jsonResponse(200, { graceMinutes: 10 }));
      return Promise.resolve(jsonResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderDialog('reenroll');

    await user.type(screen.getByLabelText('Mật khẩu hiện tại'), 'mat-khau');
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    const step = await screen.findByRole('region', { name: 'Xác nhận danh tính' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(step).getByText(PURPOSE)).toBeInTheDocument();
    expect(screen.queryByText(/xem thông tin bí mật/)).toBeNull();

    await user.type(within(step).getByLabelText('Mã xác thực'), '123456');
    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP');
    expect(reenrollCalls).toBe(2);
  });
});
