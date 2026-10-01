import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, waitFor } from '@/test/test-utils';
import { DevicesScreen } from './devices-screen';

/**
 * Q-20 — màn Thiết bị mặc định ẨN máy đã thanh lý (Kho thanh lý là nơi xem chúng): bộ lọc trống
 * gửi `status=live`. Chọn đích danh "Đã thanh lý" vẫn ra; "Mọi trạng thái" thì không lọc.
 */

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

function mockFetch() {
  const fetchMock = vi.fn((url: string) => {
    if (url.startsWith('/api/v1/devices?')) {
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }
    if (url.startsWith('/api/v1/catalog')) {
      return Promise.resolve(
        jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [] }),
      );
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function listQuery(entry: string): Promise<URLSearchParams> {
  const fetchMock = mockFetch();
  renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <DevicesScreen me={ME} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  let url = '';
  await waitFor(() => {
    url =
      fetchMock.mock.calls
        .map((call) => call[0] as string)
        .find((u) => u.startsWith('/api/v1/devices?')) ?? '';
    expect(url).not.toBe('');
  });
  return new URLSearchParams(url.split('?')[1]);
}

describe('Màn Thiết bị — bộ lọc trạng thái mặc định (Q-20)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mặc định: gửi status=live (trừ Đã thanh lý), ô lọc nói rõ điều đó', async () => {
    const query = await listQuery('/devices');
    expect(query.get('status')).toBe('live');
    expect(screen.getByRole('button', { name: 'Trạng thái' })).toHaveTextContent(
      'Đang theo dõi (trừ Đã thanh lý)',
    );
  });

  it('lọc đích danh "Đã thanh lý" vẫn ra máy đã thanh lý', async () => {
    const query = await listQuery('/devices?status=retired');
    expect(query.get('status')).toBe('retired');
  });

  it('"Tất cả (cả Đã thanh lý)": không gửi status', async () => {
    const query = await listQuery('/devices?status=all');
    expect(query.has('status')).toBe(false);
  });
});

/*
 * Bảng trống ở bộ lọc mặc định mà vẫn còn máy đã thanh lý khớp: nói chúng đang ẩn, không nói
 * "chưa có thiết bị nào" (người dùng sẽ đi thêm lại máy đã có).
 */
describe('Màn Thiết bị — trống vì máy đã thanh lý đang ẩn', () => {
  afterEach(() => vi.unstubAllGlobals());

  function render(entry: string, hidden: number) {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('/api/v1/devices?')) {
        const all = !new URLSearchParams(url.split('?')[1]).has('status');
        return Promise.resolve(jsonResponse(200, { items: [], total: all ? hidden : 0 }));
      }
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(
          jsonResponse(200, { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [] }),
        );
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithI18n(
      <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>
          <ConfirmProvider>
            <DevicesScreen me={ME} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    return fetchMock;
  }

  it('mặc định, chỉ còn máy đã thanh lý → "đang ẩn", không mời Thêm thiết bị', async () => {
    render('/devices', 2);
    expect(await screen.findByText('Có 2 hồ sơ đã thanh lý đang ẩn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tất cả (cả Đã thanh lý)' })).toBeInTheDocument();
  });

  it('tìm mã của máy đã thanh lý → "đang ẩn", không phải "không khớp"', async () => {
    render('/devices?q=PC-CU', 1);
    expect(await screen.findByText('Có 1 hồ sơ đã thanh lý đang ẩn')).toBeInTheDocument();
  });

  it('thật sự không có máy nào → khối trống gốc', async () => {
    render('/devices', 0);
    expect(await screen.findByText('Kho thiết bị đang trống.')).toBeInTheDocument();
  });
});

