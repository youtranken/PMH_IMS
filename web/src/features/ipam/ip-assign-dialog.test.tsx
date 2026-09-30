import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { todayIso } from '@/lib/format';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { AssignIpDialog } from './ip-assign-dialog';
import type { IpRow } from './ipam-types';

/**
 * NET-001 + NET-002: MỘT hộp "Cấp IP" cho ô trống lẫn hồ sơ Trống; không cho cấp khi chưa có
 * thiết bị lẫn người/bộ phận (Q-14).
 */

function mockFetch() {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(jsonResponse(200, { departments: [] }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
  return calls;
}

const FREE_RECORD: IpRow = {
  id: 'ip-1',
  subnetId: 'sub-1',
  address: '10.77.1.5',
  deviceId: null,
  deviceCode: null,
  deviceName: null,
  usedBy: null,
  assignedBy: 'e2e',
  assignedAt: '2026-01-02',
  status: 'free',
  note: 'đã thu hồi',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
};

function renderDialog(record: IpRow | null, onDone = () => {}) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <AssignIpDialog
          subnetId="sub-1"
          address="10.77.1.5"
          record={record}
          csrfToken="t"
          onClose={() => {}}
          onDone={onDone}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Hộp "Cấp IP" dùng chung', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tiêu đề, nút chính và ngày cấp mặc định hôm nay', async () => {
    mockFetch();
    renderDialog(null);
    expect(await screen.findByRole('dialog', { name: 'Cấp IP — 10.77.1.5' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cấp IP' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Thiết bị' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Lý do' })).toBeVisible();
    const [y, m, d] = todayIso().split('-');
    expect(screen.getByRole('button', { name: /Ngày cấp/ })).toHaveTextContent(
      `${d}/${m}/${y}`,
    );
  });

  it('chưa có máy lẫn người dùng: lỗi tiếng Việt dưới ô, KHÔNG gửi gì', async () => {
    const calls = mockFetch();
    renderDialog(null);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cấp IP' }));
    const device = screen.getByRole('combobox', { name: 'Thiết bị' });
    await waitFor(() => expect(device).toHaveAttribute('aria-invalid', 'true'));
    expect(device).toHaveAccessibleDescription(
      expect.stringContaining('Chọn thiết bị hoặc nhập người/phòng ban dùng IP này.'),
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('ô trống: gửi POST addresses kèm ngày cấp, ghi chú và lý do', async () => {
    const calls = mockFetch();
    const onDone = vi.fn();
    renderDialog(null, onDone);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('combobox', { name: 'Người / phòng ban dùng' }),
      'Chị Lan',
    );
    await user.type(screen.getByRole('textbox', { name: 'Lý do' }), 'máy mới');
    await user.click(screen.getByRole('button', { name: 'Cấp IP' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/v1/ipam/addresses');
    expect(post?.body).toMatchObject({
      subnetId: 'sub-1',
      address: '10.77.1.5',
      usedBy: 'Chị Lan',
      assignedAt: todayIso(),
      reason: 'máy mới',
    });
  });

  it('ô Ghi chú nhắc không ghi mật khẩu (ghi chú không mã hóa, FR-035)', async () => {
    mockFetch();
    renderDialog(null);
    expect(await screen.findByRole('textbox', { name: 'Ghi chú' })).toHaveAccessibleDescription(
      /Không ghi mật khẩu/,
    );
  });

  it('hồ sơ Trống: cùng hộp, nhưng đi đường transition để lịch sử nối tiếp', async () => {
    const calls = mockFetch();
    const onDone = vi.fn();
    renderDialog(FREE_RECORD, onDone);
    const user = userEvent.setup();
    // Chủ cũ đã đi khỏi lúc thu hồi — ô mở ra trống, ghi chú thì giữ.
    const usedBy = await screen.findByRole('combobox', { name: 'Người / phòng ban dùng' });
    expect(usedBy).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toHaveValue('đã thu hồi');
    await user.type(usedBy, 'Kho');
    await user.click(screen.getByRole('button', { name: 'Cấp IP' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe('/api/v1/ipam/addresses/ip-1/transition');
    expect(post?.body).toMatchObject({ to: 'assigned', usedBy: 'Kho' });
  });
});
