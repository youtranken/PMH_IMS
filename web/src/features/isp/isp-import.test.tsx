import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { IspScreen } from './isp-screen';

// UX-E30: đường truyền nhập được từ Excel — cùng vai với Thêm tay (mọi vai).
describe('Đường truyền — Nhập từ Excel', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('có "Nhập từ Excel": mở hộp có file mẫu', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { items: [], total: 0 }))));
    renderWithI18n(
      <MemoryRouter initialEntries={['/isp-lines']}>
        <ToastProvider>
          <ConfirmProvider>
            <IspScreen me={{ id: 'u', role: 'member', csrfToken: 't', email: 'tv@pmh.com.vn' } as unknown as Me} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Nhập từ Excel' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nhập đường truyền từ Excel' });
    expect(within(dialog).getByRole('button', { name: /Tải file mẫu/ })).toBeInTheDocument();
  });
});
