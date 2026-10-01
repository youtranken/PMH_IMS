import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { SoftwareScreen } from './software-screen';

const ME = { id: 'u-sa', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const RETIRED = {
  id: 's1',
  code: 'LIC-RET-01',
  name: 'Office cũ',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 5,
  seatUsed: 0,
  startDate: null,
  endDate: '2025-01-01',
  note: null,
  status: 'retired',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  autoRetireOn: null,
};

/* "Khôi phục…" là lối QUAY LẠI của một hồ sơ đã thanh lý — chữ xanh (`ok`), không lẫn với việc thường. */
describe('Danh sách phần mềm — màu việc trong menu ⋮', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Khôi phục… mang lớp ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).includes('/api/v1/software?')
            ? jsonResponse(200, { items: [RETIRED], total: 1 })
            : jsonResponse(200, []),
        ),
      ),
    );
    renderWithI18n(
      <MemoryRouter initialEntries={['/software?status=all']}>
        <ToastProvider>
          <ConfirmProvider>
            <SoftwareScreen me={ME} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với LIC-RET-01' }));
    expect(screen.getByRole('menuitem', { name: 'Khôi phục…' })).toHaveClass('ok');
  });
});
