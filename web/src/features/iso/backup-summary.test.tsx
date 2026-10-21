import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { BackupScreen } from './backup-screen';

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const GRID = {
  formType: '0203', year: 2026, month: 10, today: '2026-10-05', state: 'open', periodId: 'p1', canEdit: true,
  systemName: 'IMS',
  rows: [{ jobId: 'j1', no: 1, name: 'File Server E2E', lineId: 'l1', label: null, pointsNas: '1', storageNas: 'NAS', pointsCloud: null, storageCloud: null, trackedFrom: '2026-10-01', stoppedOn: null }],
  ticks: [{ lineId: 'l1', day: '2026-10-01', result: 'ok', incident: null }],
  summary: { todayDone: 0, todayTotal: 1, missed: [{ lineId: 'l1', day: '2026-10-02' }, { lineId: 'l1', day: '2026-10-03' }], unlinkedFails: [], blankDays: [] },
};

/* PW-B17: ô số "bỏ sót" và dòng "Ngày còn ô bỏ sót: 02/10, 03/10" nói cùng một việc. Bỏ dòng
   liệt kê; bấm ô số thì nhảy tới ô bỏ sót đầu tiên trên lưới. */
describe('Lưới 0203 — khối việc cần làm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('không có dòng "Ngày còn ô bỏ sót"; bấm ô số bỏ sót → con trỏ vào ô bỏ sót đầu tiên', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/iso/backup/')) return Promise.resolve(jsonResponse(200, GRID));
      return Promise.resolve(jsonResponse(200, []));
    }));
    renderWithI18n(
      <MemoryRouter initialEntries={['/iso/backup?month=2026-10']}>
        <ToastProvider>
          <ConfirmProvider>
            <BackupScreen me={SA} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const tile = await screen.findByRole('button', { name: /ô bỏ sót ở ngày đã qua/ });
    expect(screen.queryByText(/Ngày còn ô bỏ sót/)).toBeNull();
    await userEvent.click(tile);
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-state', 'missed'));
  });

  // PW-B18: ở ≤600px cột cố định chiếm hết bề ngang — không thấy ô ngày nào. Tóm tắt + một câu.
  it('điện thoại: không bày lưới, nói "Đánh lưới trên máy tính", vẫn giữ ô số', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(200, String(input).startsWith('/api/v1/iso/backup/') ? GRID : [])),
    ));
    renderWithI18n(
      <MemoryRouter initialEntries={['/iso/backup?month=2026-10']}>
        <ToastProvider>
          <ConfirmProvider>
            <BackupScreen me={SA} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Đánh lưới trên máy tính/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: /ô bỏ sót ở ngày đã qua/ })).toBeInTheDocument();
  });
});
