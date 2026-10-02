import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { SubnetForm } from './subnet-form';

afterEach(() => vi.unstubAllGlobals());

describe('SubnetForm — xem trước dải khi gõ', () => {
  /* Q-20: chỉ "254 host (đầu – cuối)" — dạng chuẩn và mask đã có ô riêng, lặp lại là rối. */
  it('chỉ nói số host và host đầu – cuối', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, {}))),
    );
    renderWithI18n(
      <ConfirmProvider>
        <SubnetForm subnet={null} existing={[]} csrfToken="t" onClose={vi.fn()} onSaved={vi.fn()} />
      </ConfirmProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /^Dải/ }), '172.16.110.0/24');
    expect(
      await screen.findByText('254 host (172.16.110.1 – 172.16.110.254)', { exact: true }),
    ).toBeInTheDocument();
  });

  /* Nút gợi ý gateway nằm dưới ô Gateway, không trôi về cột VLAN; bấm thì điền đúng ô đó. */
  it('nút "Dùng <host đầu>" nằm trong ô Gateway và điền ô Gateway', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, {}))),
    );
    renderWithI18n(
      <ConfirmProvider>
        <SubnetForm subnet={null} existing={[]} csrfToken="t" onClose={vi.fn()} onSaved={vi.fn()} />
      </ConfirmProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: /^Dải/ }), '172.16.110.0/24');
    const use = await screen.findByRole('button', { name: 'Dùng 172.16.110.1' });
    const gateway = screen.getByRole('textbox', { name: 'Gateway' });
    expect(use.closest('.field')).toBe(gateway.closest('.field'));
    await userEvent.click(use);
    expect(gateway).toHaveValue('172.16.110.1');
  });
});
