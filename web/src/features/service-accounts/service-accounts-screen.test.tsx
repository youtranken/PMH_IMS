import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
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
  endDate: null as string | null,
  status: 'active',
  createdBy: 'sa@pmh.com.vn',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function stubFetch(rows: (typeof ROW)[] = [ROW]) {
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
      return Promise.resolve(jsonResponse(200, { items: rows, total: rows.length }));
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

/*
 * Q-20: câu giải thích "khai gì ở đây" chỉ hiện ở trạng thái rỗng; có dữ liệu rồi thì người mới
 * vào vẫn cần đọc được — nằm sau nút (i) cạnh tiêu đề trang.
 */
describe('Tài khoản dịch vụ — câu giải thích sau nút (i) cạnh tiêu đề', () => {
  it('có dữ liệu: bấm (i) cạnh tiêu đề thì hiện câu giải thích', async () => {
    stubFetch();
    renderAs('sa');
    await screen.findByText('VPN kế toán');
    await userEvent.click(screen.getByRole('button', { name: 'Giải thích: Tài khoản dịch vụ' }));
    expect(
      screen.getByText('Khai email dùng chung, tài khoản VPN, cổng nhà mạng… rồi cất mật khẩu vào két.'),
    ).toBeInTheDocument();
  });
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
 * trung); lọc đích danh "Đã ngừng dùng" vẫn ra, "Tất cả (cả …)" thì không lọc.
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
      'Đang theo dõi (trừ Đã ngừng dùng)',
    );
  });

  it('lọc đích danh "Đã ngừng dùng" vẫn ra', async () => {
    expect((await listParams('/service-accounts?status=disabled')).get('status')).toBe('disabled');
  });

  it('"Tất cả (cả Đã ngừng dùng)": không gửi status', async () => {
    expect((await listParams('/service-accounts?status=all')).has('status')).toBe(false);
  });

  it('?status lạ trên URL coi như mặc định: vẫn chỉ hỏi tài khoản đang dùng', async () => {
    expect((await listParams('/service-accounts?status=abc')).get('status')).toBe('active');
  });
});

/*
 * Q-20: cột "Hết hạn" — huy hiệu hạn dùng chung (`ExpiryBadge`). Tài khoản đã ngừng dùng thì
 * "Không tính hạn" như nguồn hạn bên API (nó không nhắc tài khoản ngừng dùng).
 */
describe('Tài khoản dịch vụ — cột "Hết hạn" (Q-20)', () => {
  it('có cột; tài khoản có hạn hiện huy hiệu hạn, không có hạn ghi "Không có hạn", ngừng dùng thì "Không tính hạn"', async () => {
    stubFetch([
      { ...ROW, id: 'a', code: 'SVC-E2E-HAN', endDate: '2020-01-01' },
      { ...ROW, id: 'b', code: 'SVC-E2E-KHONG', endDate: null },
      { ...ROW, id: 'c', code: 'SVC-E2E-NGUNG', endDate: '2020-01-01', status: 'disabled' },
    ]);
    renderAs('sa');
    expect(await screen.findByRole('columnheader', { name: 'Hết hạn' })).toBeInTheDocument();
    const rowOf = (code: string) => screen.getAllByRole('row').find((tr) => tr.textContent?.includes(code))!;
    expect(rowOf('SVC-E2E-HAN').textContent).toMatch(/Quá hạn/);
    expect(rowOf('SVC-E2E-KHONG').textContent).toContain('Không có hạn');
    expect(rowOf('SVC-E2E-NGUNG').textContent).toContain('Không tính hạn');
    expect(rowOf('SVC-E2E-NGUNG').textContent).not.toMatch(/Quá hạn/);
  });
});
