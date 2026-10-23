import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { CatalogScreen } from './catalog-screen';

const SA = { id: 'u', role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn', features: null } as unknown as Me;
const JOB = { id: 'j1', no: 12, name: 'Backup ERP', trackedFrom: '2026-01-01', stoppedOn: null, lines: [] };

/* TB-21: cột số thứ tự là số — căn phải như mọi cột số khác (`.num`), không căn trái như chữ. */
describe('Danh mục phiếu — tab Job', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cột No căn phải cả tiêu đề lẫn ô', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(jsonResponse(200, String(input).includes('/iso/catalog/jobs') ? [JOB] : [])),
    ));
    renderWithI18n(
      <MemoryRouter initialEntries={['/iso/catalog?tab=jobs']}>
        <ToastProvider>
          <ConfirmProvider>
            <CatalogScreen me={SA} />
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const cell = await screen.findByRole('cell', { name: '12' });
    expect(cell).toHaveClass('num');
    expect(screen.getByRole('columnheader', { name: 'No' })).toHaveClass('num');
  });
});
