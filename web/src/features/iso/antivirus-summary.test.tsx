import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { AntivirusScreen } from './antivirus-screen';

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const GRID = {
  formType: '0208', year: 2026, month: 10, today: '2026-10-05', state: 'open', periodId: 'p1', canEdit: true,
  systemName: 'IMS', issues: [], clearDays: ['2026-10-01'], marks: [],
  summary: { pendingDays: ['2026-10-02', '2026-10-03', '2026-10-05'], missedDays: ['2026-10-02', '2026-10-03'], unlinkedIssues: [] },
};

/* PW-B15: 0203 và 0208 dựng khác nhau — 0208 một câu đậm thay hàng ô số, không có lối "Bộ phận ›". */
describe('Lưới 0208 — cùng khuôn với 0203', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hàng ô số (ngày còn trống, issue chưa có phiếu) và link "Bộ phận ›" sang Danh mục phiếu', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(200, String(input).startsWith('/api/v1/iso/antivirus/') ? GRID : [])),
    ));
    renderWithI18n(
      <MemoryRouter initialEntries={['/iso/antivirus?month=2026-10']}>
        <ToastProvider>
          <ConfirmProvider>
            <AntivirusScreen me={SA} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('ngày đã qua còn trống')).toBeInTheDocument();
    expect(screen.getByText('dòng issue chưa có phiếu 0206')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bộ phận ›' })).toHaveAttribute('href', '/iso/catalog?tab=divisions');
  });
});
