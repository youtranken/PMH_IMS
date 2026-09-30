import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';
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
