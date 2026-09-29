import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import type { CatalogEntity, CatalogRow } from '@/lib/catalog-types';
import { CatalogForm } from './catalog-form';

const LISTS = {
  sites: [{ id: 's-hcm', code: 'E2E-HCM', name: 'Hồ Chí Minh', address: null, active: true }],
  cabinets: [
    { id: 'c-1', code: 'TU-E2E-HCM-01', siteId: 's-hcm', siteCode: 'E2E-HCM', active: true },
    { id: 'c-2', code: 'TU-E2E-HCM-02', siteId: 's-hcm', siteCode: 'E2E-HCM', active: true },
  ],
  deviceTypes: [],
  vendors: [],
  departments: [{ id: 'd-1', name: 'Phòng IT E2E', description: null, active: true }],
  ispProviders: [],
  servicePorts: [
    { id: 'p-1', name: 'HTTPS', protocol: 'tcp', portFrom: 443, portTo: 443, description: null, active: true },
  ],
};

function stubFetch(save?: (url: string, init?: RequestInit) => Response) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== 'GET' && save) return Promise.resolve(save(url, init));
    return Promise.resolve(jsonResponse(200, LISTS));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderForm(entity: CatalogEntity, row: CatalogRow | null = null) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <CatalogForm entity={entity} row={row} csrfToken="t" onClose={vi.fn()} onSaved={vi.fn()} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('CatalogForm — gợi ý và cảnh báo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tủ mạng: ô "Thuộc site" đứng TRƯỚC ô Mã; chọn site thì điền sẵn mã kế tiếp', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('cabinet');
    const site = await screen.findByRole('button', { name: 'Thuộc site' });
    const code = screen.getByRole('textbox', { name: /^Mã/ });
    // Thứ tự trong DOM = thứ tự người dùng đi qua.
    expect(site.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(site);
    await user.click(await screen.findByRole('option', { name: /E2E-HCM/ }));
    expect(code).toHaveValue('TU-E2E-HCM-03');
  });

  it('sửa site: ô Mã khoá sẵn, phải bấm "Đổi mã…" và đọc cảnh báo mới gõ được', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('site', { id: 's-hcm', code: 'E2E-HCM', name: 'HCM', address: null, active: true } as CatalogRow);
    expect(screen.queryByRole('textbox', { name: /^Mã/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đổi mã…' }));
    expect(screen.getByRole('textbox', { name: /^Mã/ })).toHaveValue('E2E-HCM');
    expect(screen.getByText(/File Excel cũ và thói quen tìm theo mã cũ sẽ lệch/)).toBeInTheDocument();
  });

  it('sửa site: chỉ bấm "Đổi mã…" mà chưa gõ gì thì Esc đóng thẳng, không hỏi "bỏ dữ liệu"', async () => {
    stubFetch();
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <CatalogForm
            entity="site"
            row={{ id: 's-hcm', code: 'E2E-HCM', name: 'HCM', address: null, active: true } as CatalogRow}
            csrfToken="t"
            onClose={onClose}
            onSaved={vi.fn()}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Đổi mã…' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Bỏ những gì vừa nhập?' })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('bộ phận: gõ tên gần trùng (bỏ dấu, hoa thường) thì nhắc tên đã có', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('department');
    await waitFor(() => expect(screen.getByRole('textbox', { name: /^Tên/ })).toBeInTheDocument());
    await user.type(screen.getByRole('textbox', { name: /^Tên/ }), 'phong it e2e');
    expect(await screen.findByText('Đã có "Phòng IT E2E" — có phải cùng bộ phận?')).toBeInTheDocument();
  });

  it('dịch vụ: port + giao thức trùng dịch vụ đã có thì cảnh báo nhẹ', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderForm('service_port');
    await user.type(await screen.findByRole('textbox', { name: /^Từ port/ }), '443');
    expect(await screen.findByText(/Trùng port với "HTTPS"/)).toBeInTheDocument();
  });

  it('trùng mã (409 CATALOG_DUPLICATE) thì lỗi nằm ngay dưới ô Mã, không ở cuối form', async () => {
    stubFetch(() =>
      jsonResponse(409, { code: 'CATALOG_DUPLICATE', message: 'Mã "E2E-HCM" đã có.' }),
    );
    const user = userEvent.setup();
    renderForm('site');
    await user.type(screen.getByRole('textbox', { name: /^Mã/ }), 'E2E-HCM');
    await user.type(screen.getByRole('textbox', { name: /^Tên/ }), 'Hồ Chí Minh');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    const code = screen.getByRole('textbox', { name: /^Mã/ });
    await waitFor(() => expect(code).toHaveAttribute('aria-invalid', 'true'));
    expect(code).toHaveAccessibleDescription(/đã có/);
  });
});
