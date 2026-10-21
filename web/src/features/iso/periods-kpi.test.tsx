import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { PeriodsScreen } from './periods-screen';

const KPIS = { unlinkedFails: 1, pending: 2, reopenPending: 1, awaitingSigned: 3, done: 4 };

async function tileLabels(role: Me['role']): Promise<string[]> {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(jsonResponse(200, String(input) ? { year: 2026, months: [], kpis: KPIS } : null)),
  ));
  const me = { id: 'u', role, csrfToken: 't', email: 'x@pmh.com.vn', features: null } as unknown as Me;
  const view = renderWithI18n(
    <MemoryRouter initialEntries={['/iso/periods?year=2026']}>
      <ToastProvider>
        <ConfirmProvider>
          <PeriodsScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await screen.findByText('ô ✗ chưa có 0206');
  const labels = Array.from(document.querySelectorAll('.kpi-l'), (el) => el.textContent ?? '');
  view.unmount();
  vi.unstubAllGlobals();
  return labels;
}

/* PW-B27: Member thấy ô ✗ đứng đầu, Super Admin không có ô đó — cùng một màn mà hai thứ tự. */
describe('Kỳ phiếu — ô số cùng thứ tự cho mọi vai', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('Member và Super Admin cùng 4 ô theo cùng thứ tự', async () => {
    const member = await tileLabels('member');
    const sa = await tileLabels('sa');
    expect(member).toHaveLength(4);
    expect(sa).toEqual(member);
  });
});
