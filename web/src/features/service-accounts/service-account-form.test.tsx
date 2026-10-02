import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ServiceAccountForm } from './service-account-form';

function renderForm() {
  renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <ServiceAccountForm row={null} csrfToken="t" onClose={() => undefined} onSaved={() => undefined} />
      </ConfirmProvider>
    </ToastProvider>,
  );
  return screen.getAllByRole('dialog')[0];
}

describe('Form tài khoản dịch vụ — bố cục', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, { departments: [], items: [] }))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hộp rộng, khối Hồ sơ và Thuộc về ai xếp 4 cột', () => {
    const dialog = renderForm();
    expect(Number.parseInt(dialog.style.maxWidth, 10)).toBeGreaterThanOrEqual(960);
    for (const heading of ['Hồ sơ', 'Thuộc về ai']) {
      const section = within(dialog).getByRole('heading', { name: heading }).closest('section');
      expect(section?.querySelector('.form-grid')).toHaveAttribute('data-columns', '4');
    }
  });

  it('gợi ý dài vào nút (i) cạnh nhãn; gợi ý ngắn vẫn nằm dưới ô', () => {
    const dialog = renderForm();
    for (const label of ['Loại', 'Người phụ trách']) {
      expect(within(dialog).getByRole('button', { name: `Giải thích: ${label}` })).toBeInTheDocument();
    }
    expect(within(dialog).queryByText(/Người chịu trách nhiệm khi tài khoản có sự cố/)).toBeNull();
    expect(within(dialog).queryByText(/VPN thì có thêm nhóm/)).toBeNull();
    expect(within(dialog).getByText('Email với tài khoản dùng chung, username với VPN.')).toBeVisible();
  });
});

/*
 * Q-20: hạn dùng TÙY CHỌN — VPN / tài khoản cấp có thời hạn. Để trống là không có hạn; có
 * ngày thì hệ thống nhắc trước như mọi hạn khác.
 */
describe('Form tài khoản dịch vụ — hạn dùng (tùy chọn)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSave() {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? 'GET') !== 'GET' && String(input).includes('/service-accounts')) {
          bodies.push(JSON.parse(String(init?.body)));
          return Promise.resolve(jsonResponse(201, { id: 'sa-new', code: 'VPN-E2E', warnings: [] }));
        }
        return Promise.resolve(jsonResponse(200, { departments: [], items: [] }));
      }),
    );
    return bodies;
  }

  it('chọn ngày hết hạn thì gửi kèm endDate; để trống thì gửi rỗng (không có hạn)', async () => {
    const bodies = stubSave();
    const user = userEvent.setup();
    const dialog = renderForm();
    await user.type(within(dialog).getByRole('textbox', { name: /Tên đăng nhập/ }), 'vpn-e2e');
    within(dialog).getByRole('button', { name: 'Hết hạn (tùy chọn)' }).focus();
    await user.keyboard('3');
    await user.keyboard('1/12/2026{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ login: 'vpn-e2e', endDate: '2026-12-31' });
  });

  it('không chọn ngày: endDate rỗng', async () => {
    const bodies = stubSave();
    const user = userEvent.setup();
    const dialog = renderForm();
    await user.type(within(dialog).getByRole('textbox', { name: /Tên đăng nhập/ }), 'vpn-e2e');
    await user.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ endDate: '' });
  });
});
