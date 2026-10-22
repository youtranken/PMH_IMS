import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { ReviewScreen } from './review-screen';

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const DETAIL = {
  formType: '0203', year: 2026, month: 9, today: '2026-10-05', periodId: 'p1', state: 'open', display: 'open',
  canWrite: true, canDecide: true, submittedBy: null, submittedAt: null, lockedBy: null, lockedAt: null,
  checklist: { canSubmit: true, items: [
    { key: 'month_ended', ok: true, count: 0 },
    { key: 'no_blank', ok: true, count: 0 },
    { key: 'fails_linked', ok: true, count: 0 },
    { key: 'in_progress', ok: true, count: 0 },
  ] },
  pendingClose: null, pendingReopen: null, lastReturn: null, signed: [], signedCurrent: false, incidents: [],
  counts: { rows: 6 },
};

/* PW-B25: "0 Phiếu 0206 còn In Progress — không chặn" và "Danh sách job của kỳ: 6 job" là hai
   dòng không đòi ai làm gì. Dòng In Progress chỉ khi > 0; bỏ dòng đếm job. */
describe('Xem & duyệt — khối Kiểm trước khi gửi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('không dòng đếm job; không dòng In Progress khi là 0', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/iso/periods/0203/2026-09')) return Promise.resolve(jsonResponse(200, DETAIL));
      return Promise.resolve(jsonResponse(200, { formType: '0203', year: 2026, month: 9, today: '2026-10-05', state: 'open', periodId: 'p1', canEdit: true, systemName: 'IMS', rows: [], ticks: [], summary: { todayDone: 0, todayTotal: 0, missed: [], unlinkedFails: [], blankDays: [] } }));
    }));
    renderWithI18n(
      <MemoryRouter initialEntries={['/iso/periods/0203/2026-09/review']}>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/iso/periods/:form/:month/review" element={<ReviewScreen me={SA} />} />
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { name: /Kiểm trước khi gửi/ });
    expect(screen.queryByText(/Danh sách job của kỳ/)).toBeNull();
    expect(screen.queryByText(/In Progress/)).toBeNull();
  });
});
