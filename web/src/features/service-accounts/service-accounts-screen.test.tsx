import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { ServiceAccountsScreen } from './service-accounts-screen';

/**
 * Q-15 — danh sách tài khoản dịch vụ có cột "Đổi lần cuối" + đếm ngược tới hạn đổi mật khẩu
 * trong két. Hạn lấy từ `GET /vault/owners/due` (SA/Admin): bản đồ két không mở cho Member, nên
 * Member không có cột này và màn KHÔNG gọi tới đó.
 */

const ROW = {
  id: 'sa-1',
  code: 'SVC-E2E-01',
  kind: 'vpn',
  name: 'VPN kế toán',
  login: 'vpn.ketoan',
  department: 'Kế toán',
  ownerName: null,
  groupName: null,
  allowedIps: null,
  note: null,
  status: 'active',
  createdBy: 'sa@pmh.com.vn',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/vault/owners/due')) {
        return Promise.resolve(
          jsonResponse(200, [
            { ownerId: 'sa-1', valueChangedAt: '2026-01-10T03:00:00.000Z', dueInDays: -20 },
          ]),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [ROW], total: 1 }));
    }),
  );
  return calls;
}

function renderAs(role: 'sa' | 'member', entry = '/service-accounts') {
  const me = { id: 'u', role, csrfToken: 't', email: 'x@pmh.com.vn' } as unknown as Me;
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <ServiceAccountsScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Tài khoản dịch vụ — cột "Đổi lần cuối" (Q-15)', () => {
  it('SA/Admin: ngày đổi + "Quá N ngày — cần đổi" trên dòng', async () => {
    const calls = stubFetch();
    renderAs('sa');
    expect(await screen.findByRole('columnheader', { name: 'Đổi lần cuối' })).toBeInTheDocument();
    expect(await screen.findAllByText('Quá 20 ngày — cần đổi')).not.toHaveLength(0);
    expect(calls.some((url) => url.includes('/vault/owners/due?ownerType=service_account'))).toBe(
      true,
    );
  });

  it('Member: không có cột, không hỏi bản đồ két', async () => {
    const calls = stubFetch();
    renderAs('member');
    expect(await screen.findAllByText('SVC-E2E-01')).not.toHaveLength(0);
    expect(screen.queryByRole('columnheader', { name: 'Đổi lần cuối' })).not.toBeInTheDocument();
    expect(calls.some((url) => url.includes('/vault/owners/due'))).toBe(false);
  });
});

/*
 * Q-20 — tài khoản đã ngừng dùng ẩn khỏi danh sách theo mặc định (Kho thanh lý là nơi xem tập
 * trung); lọc đích danh "Đã ngừng dùng" vẫn ra, "Mọi trạng thái (cả …)" thì không lọc.
 */
describe('Tài khoản dịch vụ — bộ lọc trạng thái mặc định (Q-20)', () => {
  async function listParams(entry: string): Promise<URLSearchParams> {
    const calls = stubFetch();
    renderAs('member', entry);
    await screen.findAllByText('SVC-E2E-01');
    const url = calls.find((u) => u.startsWith('/api/v1/service-accounts?')) ?? '';
    return new URLSearchParams(url.split('?')[1]);
  }

  it('mặc định chỉ hỏi tài khoản đang dùng, ô lọc nói rõ', async () => {
    expect((await listParams('/service-accounts')).get('status')).toBe('active');
    expect(screen.getByRole('button', { name: 'Trạng thái' })).toHaveTextContent(
      'Mọi trạng thái (trừ Đã ngừng dùng)',
    );
  });

  it('lọc đích danh "Đã ngừng dùng" vẫn ra', async () => {
    expect((await listParams('/service-accounts?status=disabled')).get('status')).toBe('disabled');
  });

  it('"Mọi trạng thái (cả Đã ngừng dùng)": không gửi status', async () => {
    expect((await listParams('/service-accounts?status=all')).has('status')).toBe(false);
  });
});
