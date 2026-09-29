import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { todayIso } from '@/lib/format';
import { daysBetweenIso, periodRange } from '@/lib/period-range';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { ExpiryScreen } from './expiry-screen';

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const ROWS = [
  {
    id: 'b',
    label: 'LIC-E2E-AUTOCAD AutoCAD',
    code: 'LIC-E2E-AUTOCAD',
    name: 'AutoCAD',
    kind: 'license',
    start: null,
    end: '2026-09-10',
    link: '/software/b',
    daysLeft: -10,
    canRenew: true,
    autoRetireOn: '2026-10-10',
    sublabel: null,
  },
  {
    id: 'a',
    label: 'SSL-E2E-WEB web',
    code: 'SSL-E2E-WEB',
    name: 'web',
    kind: 'ssl',
    start: null,
    end: '2026-10-05',
    link: '/software/a',
    daysLeft: 15,
    canRenew: true,
    sublabel: null,
  },
];

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/expiry/kinds')) {
        return Promise.resolve(
          jsonResponse(200, [
            { kind: 'license', label: 'License phần mềm', canRenew: true },
            { kind: 'ssl', label: 'Chứng chỉ SSL', canRenew: true },
          ]),
        );
      }
      if (url.includes('/expiry/thresholds')) {
        return Promise.resolve(jsonResponse(200, { criticalDays: 7, warningDays: 30 }));
      }
      if (url.includes('/api/v1/expiry?')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: ROWS,
            total: 2,
            summary: { expired: 1, critical: 0, warning: 1, autoRetire: 1 },
            thresholds: { criticalDays: 7, warningDays: 30 },
            failedKinds: [],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderScreen(entry = '/expiry') {
  renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <ExpiryScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const lastList = (calls: string[]) =>
  new URL(calls.filter((url) => url.includes('/api/v1/expiry?')).at(-1) ?? '', 'http://x');

describe('Sắp hết hạn — sắp ở máy chủ, ô "Chờ tự thanh lý", cửa sổ theo lịch, nhóm theo tháng', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('mặc định hỏi sort=end&dir=asc; bấm cột Mục thì hỏi lại sort=label (EX-011)', async () => {
    const calls = stubFetch();
    renderScreen();
    await screen.findByText('SSL-E2E-WEB');
    expect(lastList(calls).searchParams.get('sort')).toBe('end');
    expect(lastList(calls).searchParams.get('dir')).toBe('asc');
    await userEvent.click(screen.getByRole('button', { name: 'Sắp xếp theo Mục' }));
    await waitFor(() => expect(lastList(calls).searchParams.get('sort')).toBe('label'));
  });

  it('ô thứ tư "Chờ tự thanh lý" lọc state=autoRetire (EX-005)', async () => {
    const calls = stubFetch();
    renderScreen();
    const tile = await screen.findByRole('button', { name: /Chờ tự thanh lý/ });
    expect(tile).toHaveTextContent('1');
    await userEvent.click(tile);
    await waitFor(() => expect(lastList(calls).searchParams.get('state')).toBe('autoRetire'));
  });

  it('"tới hết tháng này" quy về số ngày tới cuối tháng; bảng có tiêu đề theo tháng (EX-003)', async () => {
    const calls = stubFetch();
    renderScreen('/expiry?period=month');
    await screen.findByText('SSL-E2E-WEB');
    const today = todayIso();
    const days = Math.max(1, daysBetweenIso(today, periodRange('month', today).to));
    expect(lastList(calls).searchParams.get('withinDays')).toBe(String(days));
    expect(screen.getByRole('button', { name: 'Khoảng thời gian' })).toHaveTextContent(
      'Quá hạn + tới hết tháng này',
    );
    expect(screen.getByRole('rowheader', { name: 'Tháng 09/2026' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Tháng 10/2026' })).toBeInTheDocument();
  });

  it('"tới ngày…" cần chọn ngày: hiện ô Tới ngày', async () => {
    stubFetch();
    renderScreen('/expiry?period=custom');
    expect(await screen.findByRole('button', { name: 'Tới ngày' })).toBeInTheDocument();
  });
});
