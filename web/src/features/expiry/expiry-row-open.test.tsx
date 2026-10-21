import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ExpiryScreen } from './expiry-screen';

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const ROWS = [
  { id: 'a', label: 'SSL-E2E-WEB web', code: 'SSL-E2E-WEB', name: 'web', kind: 'ssl', start: null, end: '2026-12-05', link: '/software/a', daysLeft: 40, canRenew: true, sublabel: null },
  { id: 'w', label: 'PC-E2E-01 Máy kế toán', code: 'PC-E2E-01', name: 'Máy kế toán', kind: 'warranty', start: null, end: '2026-12-20', link: '/devices/w', daysLeft: 55, canRenew: false, sublabel: null },
];

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/expiry/kinds')) {
        return Promise.resolve(jsonResponse(200, [
          { kind: 'ssl', label: 'Chứng chỉ SSL', canRenew: true },
          { kind: 'warranty', label: 'Bảo hành thiết bị', canRenew: false },
        ]));
      }
      if (url.includes('/expiry/thresholds')) return Promise.resolve(jsonResponse(200, { criticalDays: 7, warningDays: 30 }));
      if (url.includes('/api/v1/expiry?')) {
        return Promise.resolve(jsonResponse(200, {
          items: ROWS, total: 2, summary: { expired: 0, critical: 0, warning: 0, autoRetire: 0 },
          thresholds: { criticalDays: 7, warningDays: 30 }, failedKinds: [],
        }));
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
}

/* PW-A20 / TB-20: "Mở hồ sơ ›" lặp trên mọi dòng không gia hạn được, trùng link mã ở cột Mục. */
describe('Sắp hết hạn — cột Thao tác chỉ còn Gia hạn; bấm dòng mở hồ sơ', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dòng bảo hành không có link "Mở hồ sơ"; bấm dòng → sang hồ sơ', async () => {
    stubFetch();
    renderWithI18n(
      <MemoryRouter initialEntries={['/expiry']}>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/expiry" element={<ExpiryScreen me={me} />} />
              <Route path="/devices/:id" element={<p>trang thiết bị</p>} />
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const row = (await screen.findByText('Máy kế toán')).closest('tr')!;
    expect(within(row).queryByRole('link', { name: 'Mở hồ sơ' })).toBeNull();
    const sslRow = screen.getByText('SSL-E2E-WEB').closest('tr')!;
    expect(within(sslRow).getByRole('button', { name: 'Gia hạn' })).toBeInTheDocument();
    await userEvent.click(within(row).getByText('Bảo hành thiết bị'));
    expect(await screen.findByText('trang thiết bị')).toBeInTheDocument();
  });

  // PW-A30: tab Luật trống — nút "Thêm luật" chỉ ở khung trống, không lặp ở đầu trang.
  it('tab Luật chưa có luật nào → đúng một nút "Thêm luật"', async () => {
    stubFetch();
    renderWithI18n(
      <MemoryRouter initialEntries={['/expiry']}>
        <ToastProvider>
          <ConfirmProvider>
            <ExpiryScreen me={me} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: /Luật gửi báo cáo/ }));
    expect(await screen.findByText('Chưa có luật gửi báo cáo nào.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Thêm luật' })).toHaveLength(1);
  });
});
