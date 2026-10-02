import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import type { SoftwareScreenKey } from '@/lib/software-screens';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { SoftwareDetail } from './software-detail';
import { SoftwareScreen } from './software-screen';
import type { SoftwareRow } from './software-types';

const ME = { id: 'u-sa', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;
const CATALOG = { vendors: [], sites: [], cabinets: [], deviceTypes: [], departments: [] };

function row(over: Partial<SoftwareRow>): SoftwareRow {
  return {
    id: 's1',
    code: 'SSL-E2E-01',
    name: 'Cert pmh',
    kind: 'ssl',
    licenseModel: 'subscription',
    vendorId: null,
    vendorName: null,
    seatTotal: null,
    seatUsed: 0,
    startDate: null,
    endDate: '2030-01-01',
    note: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    autoRetireOn: null,
    websites: [],
    ...over,
  };
}

/** Ghi lại mọi URL danh sách đã hỏi — bài đọc `kind` trong đó. */
function mockFetch(items: SoftwareRow[] = [], detail?: SoftwareRow) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, CATALOG));
      if (url.startsWith('/api/v1/software?')) {
        return Promise.resolve(jsonResponse(200, { items, total: items.length }));
      }
      if (detail && url === `/api/v1/software/${detail.id}`) {
        return Promise.resolve(jsonResponse(200, { ...detail, retirement: null }));
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return urls;
}

function Where() {
  const location = useLocation();
  return <output aria-label="địa chỉ">{`${location.pathname}${location.search}`}</output>;
}

function renderList(screenKey: SoftwareScreenKey, at: string) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[at]}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="*" element={<><SoftwareScreen me={ME} screen={screenKey} /><Where /></>} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

function kindsAsked(urls: string[]): (string | null)[] {
  return urls
    .filter((url) => url.startsWith('/api/v1/software?'))
    .map((url) => new URLSearchParams(url.split('?')[1]).get('kind'));
}

afterEach(() => vi.unstubAllGlobals());

describe('Bốn màn tách từ Phần mềm (Q-22) — mỗi màn chỉ hỏi loại của nó', () => {
  it.each([
    ['software', PATHS.software, 'Phần mềm', 'license', 'Thêm phần mềm'],
    ['domains', PATHS.domains, 'Tên miền & SSL', 'domain,ssl', 'Thêm tên miền / SSL'],
    ['maintenance', PATHS.maintenance, 'Hợp đồng bảo trì', 'maintenance', 'Thêm hợp đồng bảo trì'],
    ['services', PATHS.services, 'Dịch vụ có hạn khác', 'other', 'Thêm dịch vụ'],
  ] as const)('%s: tiêu đề, nút thêm và `kind` gửi lên API', async (key, path, title, kind, add) => {
    const urls = mockFetch();
    renderList(key, path);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    await waitFor(() => expect(kindsAsked(urls).length).toBeGreaterThan(0));
    expect(new Set(kindsAsked(urls))).toEqual(new Set([kind]));
    expect(screen.getAllByRole('button', { name: add }).length).toBeGreaterThan(0);
  });

  it('Phần mềm: không còn ô lọc Loại; còn lọc Kỳ hạn', async () => {
    mockFetch();
    renderList('software', PATHS.software);
    await screen.findByRole('heading', { level: 1, name: 'Phần mềm' });
    expect(screen.queryByRole('button', { name: 'Loại' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kỳ hạn' })).toBeInTheDocument();
  });

  it('Tên miền & SSL: lọc loại Tất cả / Tên miền / Chứng chỉ SSL, chọn SSL thì chỉ hỏi ssl', async () => {
    const urls = mockFetch();
    renderList('domains', `${PATHS.domains}?kind=ssl`);
    await screen.findByRole('heading', { level: 1, name: 'Tên miền & SSL' });
    await waitFor(() => expect(kindsAsked(urls)).toContain('ssl'));
    expect(kindsAsked(urls)).not.toContain('domain,ssl');
    expect(screen.queryByRole('button', { name: 'Kỳ hạn' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Loại' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Tất cả', 'Tên miền', 'Chứng chỉ SSL']);
  });

  it('Tên miền & SSL: cột Tên miền hiện tên đầu + "+N", rê chuột thấy đủ', async () => {
    mockFetch([row({ websites: ['pmh.com.vn', 'shop.pmh.com.vn', 'mail.pmh.com.vn'] })]);
    renderList('domains', PATHS.domains);
    const cell = await screen.findByText('pmh.com.vn');
    expect(cell.closest('[title]')).toHaveAttribute(
      'title',
      'pmh.com.vn, shop.pmh.com.vn, mail.pmh.com.vn',
    );
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Ghế/ })).toBeNull();
  });

  it('link mã hồ sơ đi vào trang chi tiết của CHÍNH màn đó', async () => {
    mockFetch([row({ id: 'm1', code: 'MNT-E2E-01', kind: 'maintenance' })]);
    renderList('maintenance', PATHS.maintenance);
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'MNT-E2E-01' })).toHaveAttribute(
      'href',
      PATHS.maintenanceItem('m1'),
    );
  });

  it('link cũ /software?kind=ssl chuyển sang /domains?kind=ssl (thay chỗ trong lịch sử)', async () => {
    mockFetch();
    renderList('software', '/software?kind=ssl&q=pmh');
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'địa chỉ' })).toHaveTextContent('/domains?kind=ssl&q=pmh'),
    );
  });
});

describe('Trang chi tiết — đúng màn theo loại hồ sơ', () => {
  function renderDetail(at: string) {
    return renderWithI18n(
      <MemoryRouter initialEntries={[at]}>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path={`${PATHS.software}/:id`} element={<SoftwareDetail me={ME} screen="software" />} />
              <Route path={`${PATHS.domains}/:id`} element={<SoftwareDetail me={ME} screen="domains" />} />
            </Routes>
            <Where />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it('mở /software/<id> của một SSL (link trong thư cũ) → về /domains/<id>, giữ ?tab=', async () => {
    mockFetch([], row({ id: 's9', code: 'SSL-E2E-09' }));
    renderDetail('/software/s9?tab=vault');
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'địa chỉ' })).toHaveTextContent('/domains/s9?tab=vault'),
    );
  });

  it('crumb đầu dẫn về danh sách của màn, crumb loại lọc sẵn đúng loại', async () => {
    mockFetch([], row({ id: 's9', code: 'SSL-E2E-09' }));
    renderDetail('/domains/s9');
    const crumbs = await screen.findByRole('navigation', { name: /đường dẫn|breadcrumb/i });
    expect(within(crumbs).getByRole('link', { name: 'Tên miền & SSL' })).toHaveAttribute('href', PATHS.domains);
    expect(within(crumbs).getByRole('link', { name: 'Chứng chỉ SSL' })).toHaveAttribute(
      'href',
      `${PATHS.domains}?kind=ssl`,
    );
  });
});
