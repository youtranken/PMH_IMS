import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { ExpiryScreen } from './expiry-screen';

/**
 * EX-002 — một nguồn hạn lỗi thì API vẫn trả phần còn lại kèm `failedKinds`. Màn phải NÓI
 * ra: danh sách và ô số có thể thiếu. Im lặng thì "Đã quá hạn: 7" đọc y như một con số đủ.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

function stubFetch(failedKinds: string[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/expiry/kinds')) {
        return Promise.resolve(
          jsonResponse(200, [
            { kind: 'device_warranty', label: 'Bảo hành thiết bị', canRenew: false },
            { kind: 'license', label: 'License phần mềm', canRenew: true },
          ]),
        );
      }
      if (url.includes('/expiry/thresholds')) {
        return Promise.resolve(jsonResponse(200, { criticalDays: 7, warningDays: 30 }));
      }
      if (url.includes('/api/v1/expiry?')) {
        return Promise.resolve(
          jsonResponse(200, {
            items: [],
            total: 0,
            summary: { expired: 7, critical: 0, warning: 2 },
            thresholds: { criticalDays: 7, warningDays: 30 },
            failedKinds,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  return calls;
}

function renderScreen() {
  renderWithI18n(
    <MemoryRouter>
      <ToastProvider>
        <ConfirmProvider>
          <ExpiryScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Màn Sắp hết hạn — nguồn hạn lỗi (failedKinds)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('nói tên nguồn lỗi, ô số hiện "7+" kèm lời giải thích, bấm Thử lại thì hỏi lại', async () => {
    const calls = stubFetch(['device_warranty']);
    renderScreen();

    const alert = await screen.findByText(/Không đọc được: Bảo hành thiết bị/);
    expect(alert).toBeInTheDocument();
    const tile = screen.getByRole('button', { name: /Đã quá hạn/ });
    expect(tile).toHaveTextContent('7+');
    expect(tile).toHaveAttribute('title', expect.stringContaining('Bảo hành thiết bị'));
    // Số 0 vẫn có thể thiếu: "0+" chứ không phải "0" yên tâm.
    expect(screen.getByRole('button', { name: /Gấp/ })).toHaveTextContent('0+');

    const before = calls.filter((url) => url.includes('/api/v1/expiry?')).length;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() =>
      expect(calls.filter((url) => url.includes('/api/v1/expiry?')).length).toBeGreaterThan(before),
    );
  });

  it('không nguồn nào lỗi: không có cảnh báo, ô số là số trần', async () => {
    stubFetch([]);
    renderScreen();
    const tile = await screen.findByRole('button', { name: /Đã quá hạn/ });
    expect(tile).toHaveTextContent(/^7/);
    expect(tile).not.toHaveTextContent('+');
    expect(screen.queryByText(/Không đọc được/)).not.toBeInTheDocument();
  });
});
