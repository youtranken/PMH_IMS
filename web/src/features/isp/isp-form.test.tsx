import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { IspForm } from './isp-form';
import type { IspRow } from './isp-types';

/**
 * OLD-DB-01 (QUYET-DINH Q-11) — nhà mạng CHỌN từ danh mục, gửi đi bằng id.
 *
 * Ô gõ tự do có gợi ý để lọt "fpt " bên cạnh "FPT", và đổi tên trong danh mục không tới được hồ
 * sơ nào. Bài này giữ ba điều: ô là ô CHỌN (không gõ được), mục ngừng dùng không mời chọn mới,
 * và thứ đi lên server là `providerId` chứ không phải chữ.
 */

const PROVIDERS = [
  { id: 'p-fpt', name: 'FPT Telecom', hotline: null, contact: null, active: true },
  { id: 'p-vnpt', name: 'VNPT', hotline: null, contact: null, active: true },
  { id: 'p-cu', name: 'Nhà mạng cũ', hotline: null, contact: null, active: false },
];

const LISTS = {
  sites: [],
  cabinets: [],
  deviceTypes: [],
  vendors: [],
  departments: [],
  ispProviders: PROVIDERS,
  servicePorts: [],
};

function mockFetch() {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/v1/catalog')) return Promise.resolve(jsonResponse(200, LISTS));
      if (url.startsWith('/api/v1/files')) return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(200, { id: 'new-id' }));
    }),
  );
  return calls;
}

function renderForm(row: IspRow | null) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <IspForm row={row} csrfToken="t" onClose={() => undefined} onSaved={() => undefined} />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

const ROW_ON_INACTIVE = {
  id: 'line-1',
  code: 'ISP-CU',
  provider: 'Nhà mạng cũ',
  providerId: 'p-cu',
  bandwidth: null,
  wanIp: null,
  siteId: null,
  siteCode: null,
  deviceId: null,
  deviceCode: null,
  deviceName: null,
  hotline: null,
  contractNo: null,
  startDate: null,
  note: null,
  status: 'active',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
} as IspRow;

describe('Form đường truyền — nhà mạng chọn từ danh mục', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ô Nhà mạng là ô chọn, chỉ mời mục đang dùng; lưu gửi providerId', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();

    const picker = screen.getByRole('button', { name: 'Nhà mạng' });
    expect(picker).toHaveAttribute('aria-haspopup', 'listbox');
    expect(screen.queryByRole('combobox', { name: 'Nhà mạng' })).toBeNull();

    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/catalog'))).toBe(true));
    await user.click(picker);
    expect(await screen.findByRole('option', { name: 'FPT Telecom' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Nhà mạng cũ/ })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'VNPT' }));

    await user.type(screen.getByLabelText(/Mã đường/), 'ISP-E2E-01');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/isp-lines')).toBe(true));
    const body = calls.find((c) => c.url === '/api/v1/isp-lines')!.body as Record<string, unknown>;
    expect(body.providerId).toBe('p-vnpt');
    expect(body).not.toHaveProperty('provider');
  });

  it('chưa chọn nhà mạng → báo lỗi, không gửi', async () => {
    const calls = mockFetch();
    renderForm(null);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Mã đường/), 'ISP-E2E-02');
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    // Câu lỗi nằm DƯỚI ô Nhà mạng và nối vào chính ô đó, không phải một khối chung đầu form.
    const picker = screen.getByRole('button', { name: 'Nhà mạng' });
    await waitFor(() => expect(picker).toHaveAttribute('aria-invalid', 'true'));
    expect(picker).toHaveAccessibleDescription(/chưa chọn ô này/);
    expect(calls.some((c) => c.url === '/api/v1/isp-lines')).toBe(false);
  });

  it('ô Ghi chú nhắc không ghi mật khẩu (ghi chú không mã hóa, FR-035)', () => {
    mockFetch();
    renderForm(null);
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toHaveAccessibleDescription(
      /Không ghi mật khẩu/,
    );
  });

  it('hồ sơ đang trỏ vào mục ngừng dùng vẫn hiện đúng mục đó', async () => {
    mockFetch();
    renderForm(ROW_ON_INACTIVE);
    const picker = screen.getByRole('button', { name: 'Nhà mạng' });
    await waitFor(() => expect(picker).toHaveTextContent(/Nhà mạng cũ \(ngừng dùng\)/));
  });

  /*
   * Đổi trạng thái chỉ đi menu ⋮ của trang chi tiết: ở đó hộp hỏi lại nhắc ngăn két và thiết bị
   * biên. Ô Trạng thái trong form là lối tắt bỏ qua cả hai, và gửi lại trạng thái cũ lúc lưu thì
   * đè mất lượt đổi trạng thái vừa làm ở tab khác.
   */
  it('form sửa KHÔNG có ô Trạng thái, lưu không gửi `status`', async () => {
    const calls = mockFetch();
    renderForm(ROW_ON_INACTIVE);
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Trạng thái' })).toBeNull();
    expect(screen.queryByText('Trạng thái', { exact: true })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/isp-lines/line-1')).toBe(true));
    const body = calls.find((c) => c.url === '/api/v1/isp-lines/line-1')!.body;
    expect(body).not.toHaveProperty('status');
    expect(screen.queryByRole('dialog', { name: /^Thanh lý/ })).toBeNull();
  });
});

describe('Bố cục form đường truyền', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hộp rộng, hai khối xếp 4 cột — không thành dây dọc cao hơn màn laptop', () => {
    mockFetch();
    renderForm(ROW_ON_INACTIVE);
    const dialog = screen.getAllByRole('dialog')[0];
    expect(Number.parseInt(dialog.style.maxWidth, 10)).toBeGreaterThanOrEqual(960);
    for (const heading of ['Hồ sơ', 'Hợp đồng và liên hệ sự cố']) {
      const section = within(dialog).getByRole('heading', { name: heading }).closest('section');
      expect(section?.querySelector('.form-grid')).toHaveAttribute('data-columns', '4');
    }
  });

  it('gợi ý dài của ô Nhà mạng nằm sau nút (i); ô vẫn trỏ đúng mô tả còn lại', () => {
    mockFetch();
    renderForm(null);
    expect(screen.getByRole('button', { name: 'Giải thích: Nhà mạng' })).toBeInTheDocument();
    expect(screen.queryByText(/Chọn từ danh mục Nhà mạng/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Nhà mạng' })).not.toHaveAttribute(
      'aria-describedby',
      'isp-provider-hint',
    );
  });
});
