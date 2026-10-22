import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, userEvent, within, waitFor } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { CatalogScreen } from './catalog-screen';

/** UX-E25 (Q-33): Danh mục chọn nhiều mục rồi Ngừng dùng / Dùng lại một lượt. */

const SA = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;
const MEMBER = { role: 'member', csrfToken: 't', email: 'tv@pmh.com.vn' } as unknown as Me;
const VENDORS = [
  { id: 'v1', name: 'NCC E2E Một', phone: null, email: null, note: null, active: true },
  { id: 'v2', name: 'NCC E2E Hai', phone: null, email: null, note: null, active: true },
  { id: 'v3', name: 'NCC E2E Ba', phone: null, email: null, note: null, active: false },
];

function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    if (init?.method === 'POST' && url.pathname === '/api/v1/catalog/vendor/bulk-active') {
      return Promise.resolve(jsonResponse(200, { changed: 2, active: false }));
    }
    if (url.pathname === '/api/v1/catalog') {
      return Promise.resolve(
        jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: VENDORS, departments: [], ispProviders: [], servicePorts: [] }),
      );
    }
    if (url.pathname === '/api/v1/catalog/vendor') return Promise.resolve(jsonResponse(200, { items: VENDORS, total: 3 }));
    return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAt(me: Me) {
  return renderWithI18n(
    <MemoryRouter initialEntries={['/admin/catalog?tab=vendor']}>
      <ToastProvider>
        <ConfirmProvider>
          <CatalogScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Danh mục — thao tác hàng loạt (UX-E25)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chọn hai mục đang dùng → "Ngừng dùng 2 mục" hỏi lại rồi gửi một lượt', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderAt(SA);
    await screen.findByText('NCC E2E Một');
    await user.click(screen.getByRole('checkbox', { name: 'Chọn NCC E2E Một' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chọn NCC E2E Hai' }));
    const bar = screen.getByRole('group', { name: 'Thao tác với các mục đã chọn' });
    expect(within(bar).getByText('Đã chọn 2')).toBeInTheDocument();
    // Không có mục nào đang ngừng trong số đã chọn → không bày "Dùng lại".
    expect(within(bar).queryByRole('button', { name: /^Dùng lại/ })).toBeNull();
    await user.click(within(bar).getByRole('button', { name: 'Ngừng dùng 2 mục' }));
    const confirm = await screen.findByRole('dialog', { name: 'Ngừng dùng 2 mục' });
    await user.click(within(confirm).getByRole('button', { name: 'Ngừng dùng 2 mục' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/v1/catalog/vendor/bulk-active'));
      expect(call).toBeDefined();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ ids: ['v1', 'v2'], active: false });
    });
    expect(await screen.findByText('Đã ngừng dùng 2 mục.')).toBeInTheDocument();
  });

  it('chọn lẫn đang dùng + đã ngừng: hai nút, mỗi nút chỉ gửi mục cần đổi', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderAt(SA);
    await screen.findByText('NCC E2E Ba');
    await user.click(screen.getByRole('checkbox', { name: 'Chọn NCC E2E Một' }));
    await user.click(screen.getByRole('checkbox', { name: 'Chọn NCC E2E Ba' }));
    const bar = screen.getByRole('group', { name: 'Thao tác với các mục đã chọn' });
    await user.click(within(bar).getByRole('button', { name: 'Dùng lại 1 mục' }));
    const confirm = await screen.findByRole('dialog', { name: 'Dùng lại 1 mục' });
    await user.click(within(confirm).getByRole('button', { name: 'Dùng lại 1 mục' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/bulk-active'));
      expect(JSON.parse(String(call![1]!.body))).toEqual({ ids: ['v3'], active: true });
    });
  });

  it('Thành viên không có ô chọn (ngừng dùng chỉ SA/Admin, Q-12)', async () => {
    stubFetch();
    renderAt(MEMBER);
    await screen.findByText('NCC E2E Một');
    expect(screen.queryByRole('checkbox', { name: 'Chọn NCC E2E Một' })).toBeNull();
  });
});
