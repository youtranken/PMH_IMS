import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { CatalogScreen } from './catalog-screen';

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const PEOPLE = [{ id: 'p1', email: 'lan@pmh.com.vn', fullName: 'Nguyễn Lan' }];

function render() {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith('/iso/catalog/owners')) {
      return Promise.resolve(jsonResponse(200, [
        { formType: '0203', primary: null, backup: null },
        { formType: '0208', primary: null, backup: null },
      ]));
    }
    if (url.endsWith('/iso/catalog/people')) return Promise.resolve(jsonResponse(200, PEOPLE));
    return Promise.resolve(jsonResponse(200, []));
  }));
  renderWithI18n(
    <MemoryRouter initialEntries={['/iso/catalog?tab=owners']}>
      <ToastProvider>
        <ConfirmProvider>
          <CatalogScreen me={SA} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return calls;
}

/* UX-E06 + PW-B32: cột "Mail nhắc gửi cho" lặp cùng câu trên mọi dòng, dòng 0206 chỉ là một câu
   giải thích; mỗi dòng một nút Lưu xám. Đổi người là lưu luôn. */
describe('Danh mục phiếu — tab Người phụ trách', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('không cột "Mail nhắc gửi cho", không dòng 0206, không nút Lưu', async () => {
    render();
    await screen.findByText(/0203/, { selector: 'strong' });
    expect(screen.queryByRole('columnheader', { name: 'Mail nhắc gửi cho' })).toBeNull();
    expect(screen.queryByText(/^0206 ·/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu' })).toBeNull();
  });

  it('chọn người phụ trách chính → gửi PUT ngay', async () => {
    const calls = render();
    await userEvent.click(await screen.findByRole('button', { name: 'Phụ trách chính 0203' }));
    await userEvent.click(await screen.findByRole('option', { name: /Nguyễn Lan/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
        url: '/api/v1/iso/catalog/owners/0203',
        body: { primaryUserId: 'p1', backupUserId: null },
      }),
    );
  });
});
