import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { IncidentScreen } from './incident-screen';

const MEMBER = { id: 'u-m', role: 'member', csrfToken: 't', email: 'm@pmh.com.vn', features: null } as unknown as Me;

const BASE = {
  id: 'i1', code: '0206-2026-004', year: 2026, month: 10, createdBy: 'sa@pmh.com.vn', createdByName: 'Super Admin',
  createdAt: '2026-10-05T02:00:00Z', contentUpdatedAt: '2026-10-05T02:00:00Z', cells: [], governing: ['0203'],
  locked: false, inReview: false, signedCurrent: false, signed: [], canWrite: true,
  reportedOn: '2026-10-05', kind: 'backup', detectedAt: '2026-10-05T01:00:00Z', resolvedAt: null, severity: 'medium',
  status: 'in_progress', description: 'Job lỗi', correctiveAction: '', backupDetails: [],
};

function renderIncident(over: Partial<typeof BASE>) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/v1/iso/incidents/i1') return Promise.resolve(jsonResponse(200, { ...BASE, ...over }));
    return Promise.resolve(jsonResponse(200, []));
  }));
  renderWithI18n(
    <MemoryRouter initialEntries={['/iso/incidents/i1']}>
      <ToastProvider>
        <ConfirmProvider>
          <Routes>
            <Route path="/iso/incidents/:id" element={<IncidentScreen me={MEMBER} />} />
          </Routes>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/* PW-B11: "sửa được tới khi kỳ chốt" ở cả phụ đề lẫn băng, và Thành viên không phụ trách vẫn đọc câu đó. */
describe('Chi tiết phiếu 0206 — phụ đề một ý, băng nói đúng người đọc', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('phụ đề chỉ "Thuộc kỳ 10/2026"', async () => {
    renderIncident({});
    expect(await screen.findByText('Thuộc kỳ 10/2026')).toBeInTheDocument();
  });

  it('không phụ trách (canWrite false): băng "Chỉ xem — bạn không phụ trách phiếu này.", không câu "sửa được"', async () => {
    renderIncident({ canWrite: false });
    expect(await screen.findByText(/Chỉ xem — bạn không phụ trách phiếu này\./)).toBeInTheDocument();
    expect(screen.queryByText(/sửa được/)).toBeNull();
  });

  it('kỳ đã chốt: băng "Đã chốt · chỉ xem"', async () => {
    renderIncident({ locked: true });
    expect(await screen.findByText(/Đã chốt · chỉ xem/)).toBeInTheDocument();
  });
});
