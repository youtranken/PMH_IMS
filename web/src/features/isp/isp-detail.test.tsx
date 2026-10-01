import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { IspDetail } from './isp-detail';
import type { IspRow } from './isp-types';

const me = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const LINE: IspRow = {
  id: 'l1',
  code: 'ISP-E2E-01',
  provider: 'FPT Telecom',
  providerId: 'p-fpt',
  bandwidth: '300 Mbps',
  wanIps: [],
  siteId: null,
  siteCode: null,
  deviceId: 'd-fw',
  deviceCode: 'FW-E2E-01',
  deviceName: 'Draytek',
  hotline: null,
  contractNo: 'HD-123',
  startDate: null,
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function renderLine(line: IspRow) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/isp-lines/l1') return Promise.resolve(jsonResponse(200, line));
      if (url.startsWith('/api/v1/ipam/devices/addresses')) return Promise.resolve(jsonResponse(200, {}));
      if (url.startsWith('/api/v1/devices/')) return Promise.resolve(jsonResponse(200, { model: null }));
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  renderWithI18n(
    <MemoryRouter initialEntries={['/isp-lines/l1']}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/isp-lines/:id" element={<IspDetail me={me} />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Trang đường truyền — không nói một điều hai lần', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('đường đang dùng: thiết bị đầu cuối chỉ ở thẻ "Khi mất mạng", tên nhà mạng không lặp cạnh số hợp đồng', async () => {
    renderLine(LINE);
    expect(await screen.findAllByRole('link', { name: 'FW-E2E-01' })).toHaveLength(1);
    // Tên nhà mạng là tên trang (h1) và breadcrumb — không thêm lần nữa ở dòng số hợp đồng.
    const contract = screen.getByText('HD-123').closest('.rail-row') ?? screen.getByText('HD-123').parentElement;
    expect(contract).not.toHaveTextContent('FPT Telecom');
  });

  it('đường đã thanh lý: thẻ sự cố ẩn nên thiết bị hiện ở lưới hồ sơ', async () => {
    renderLine({ ...LINE, status: 'terminated' });
    expect(await screen.findAllByRole('link', { name: 'FW-E2E-01' })).toHaveLength(1);
  });
});

describe('Trang đường truyền — nhiều IP WAN (Q-20)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('hiện mọi IP, mỗi IP một nút chép', async () => {
    renderLine({ ...LINE, wanIps: ['113.161.10.20', '113.161.10.21'] });
    expect(await screen.findByText('113.161.10.20')).toBeVisible();
    expect(screen.getByText('113.161.10.21')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Chép IP WAN 113.161.10.20' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chép IP WAN 113.161.10.21' })).toBeInTheDocument();
  });
});
