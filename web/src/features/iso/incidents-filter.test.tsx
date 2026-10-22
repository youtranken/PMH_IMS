import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { IncidentsScreen } from './incidents-screen';

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const base = {
  year: 2026, month: 10, createdBy: 'sa@pmh.com.vn', createdByName: 'Super Admin', createdAt: '2026-10-05T02:00:00Z',
  contentUpdatedAt: '2026-10-05T02:00:00Z', governing: ['0203'], locked: false, inReview: false, signedCurrent: false, signed: [],
  reportedOn: '2026-10-05', kind: 'backup', detectedAt: '2026-10-05T01:00:00Z', resolvedAt: null, severity: 'medium',
  status: 'in_progress', correctiveAction: '', backupDetails: [],
};
const ITEMS = [
  { ...base, id: 'i1', code: '0206-2026-004', description: 'Job VSS lỗi', cells: [{ form: '0203', lineId: 'l1', day: '2026-10-05', issueId: null, label: 'File Server-1 · OS' }] },
  { ...base, id: 'i2', code: '0206-2026-005', description: 'Máy kế toán nhiễm virus', cells: [] },
];

/* UX-E31: thanh lọc tự dựng, không gập ở 390px, không tìm được theo số phiếu / máy. */
describe('Danh sách 0206 — FilterBar chung có ô tìm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gõ "file server" (không dấu, không hoa) → chỉ còn phiếu gắn ô của File Server-1; "Thuộc phiếu" là chọn một', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(200, String(input).startsWith('/api/v1/iso/incidents?') ? { items: ITEMS, unlinked: [] } : [])),
    ));
    renderWithI18n(
      <MemoryRouter initialEntries={['/iso/incidents?year=2026']}>
        <ToastProvider>
          <ConfirmProvider>
            <IncidentsScreen me={SA} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('0206-2026-005');
    await userEvent.type(screen.getByRole('searchbox'), 'file server');
    expect(screen.getAllByText('0206-2026-004').length).toBeGreaterThan(0);
    expect(screen.queryByText('0206-2026-005')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Thuộc phiếu' })).toBeInTheDocument();
  });
});
