import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ExpiryScreen, renewalsQuery } from './expiry-screen';

/** EX-008 — tab "Đã gia hạn": người gia hạn bằng họ tên, lọc được theo khoảng ngày (API lọc). */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const RENEWAL = {
  id: 'r1',
  objectKind: 'license',
  objectId: 's1',
  label: 'Office E2E',
  oldEnd: '2026-09-01',
  newEnd: '2027-09-01',
  actor: 'le.minh@pmh.com.vn',
  actorName: 'Lê Minh',
  createdAt: '2026-09-20T02:00:00.000Z',
};

describe('renewalsQuery', () => {
  it.each([
    [{ from: '', to: '' }, ''],
    [{ from: '2026-09-01', to: '' }, 'from=2026-09-01'],
    [{ from: '2026-09-01', to: '2026-09-30' }, 'from=2026-09-01&to=2026-09-30'],
  ])('%j → %s', (range, expected) => {
    expect(renewalsQuery(range)).toBe(expected);
  });
});

describe('Tab "Đã gia hạn"', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('người gia hạn hiện họ tên, email trong tooltip; có ô khoảng ngày', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/expiry/renewals')) return Promise.resolve(jsonResponse(200, [RENEWAL]));
        if (url.includes('/api/v1/expiry?')) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [],
              total: 0,
              summary: { expired: 0, critical: 0, warning: 0 },
              thresholds: { criticalDays: 7, warningDays: 30 },
              failedKinds: [],
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <ExpiryScreen me={me} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Đã gia hạn' }));
    expect((await screen.findAllByText('Lê Minh'))[0]).toHaveAttribute('title', 'le.minh@pmh.com.vn');
    expect(screen.getByRole('group', { name: 'Khoảng ngày gia hạn' })).toBeInTheDocument();
  });
});

describe('Gia hạn từ màn Sắp hết hạn — MỘT toast', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('toast "Đã gia hạn …" mang nút "Xem trong Đã gia hạn"; không có toast thứ hai', async () => {
    const ROW = {
      id: 's1',
      label: 'SSL-E2E-01 · Chứng chỉ web',
      code: 'SSL-E2E-01',
      name: 'Chứng chỉ web',
      sublabel: null,
      kind: 'ssl',
      start: null,
      end: '2099-12-31',
      link: '/software/s1',
      daysLeft: 3,
      canRenew: true,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if ((init?.method ?? 'GET') === 'POST') return Promise.resolve(jsonResponse(201, {}));
        if (url.includes('/api/v1/expiry?')) {
          return Promise.resolve(
            jsonResponse(200, {
              items: [ROW],
              total: 1,
              summary: { expired: 0, critical: 1, warning: 0 },
              thresholds: { criticalDays: 7, warningDays: 30 },
              failedKinds: [],
            }),
          );
        }
        return Promise.resolve(jsonResponse(200, []));
      }),
    );
    renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <ConfirmProvider>
            <ExpiryScreen me={me} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Gia hạn' }))[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '+1 năm' }));
    await user.click(within(dialog).getByRole('button', { name: 'Gia hạn' }));
    expect(await screen.findByText(/^Đã gia hạn SSL-E2E-01 tới/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Xem trong Đã gia hạn' })).toHaveLength(1);
    expect(screen.queryByText(/Lượt gia hạn đã ghi vào tab/)).toBeNull();
  });
});
