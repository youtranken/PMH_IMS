import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function stubFetch(software: unknown[], total = software.length) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/software')) return Promise.resolve(jsonResponse(200, { items: software, total }));
      if (url.includes('/ipam/')) return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }),
  );
}

async function openPalette() {
  const user = userEvent.setup();
  renderWithI18n(
    <MemoryRouter>
      <ConfirmProvider>
        <CommandPalette me={me} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
  await user.keyboard('{Control>}k{/Control}');
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Q-22: hồ sơ phần mềm đứng dưới tên MÀN của loại nó, và mở thẳng trang của màn đó. */
describe('Tìm nhanh — bốn màn tách từ Phần mềm', () => {
  it('SSL dưới "Tên miền & SSL", hợp đồng dưới "Hợp đồng bảo trì" — link đúng màn', async () => {
    stubFetch([
      { id: 's1', code: 'SSL-E2E-PMH', name: 'Cert pmh', kind: 'ssl' },
      { id: 'm1', code: 'MNT-E2E-UPS', name: 'Bảo trì UPS', kind: 'maintenance' },
      { id: 'l1', code: 'LIC-E2E-OFF', name: 'Office', kind: 'license' },
    ]);
    const user = await openPalette();
    await user.type(screen.getByRole('combobox'), 'e2e');

    const domains = await screen.findByRole('group', { name: 'Tên miền & SSL' });
    expect(within(domains).getByRole('option', { name: /SSL-E2E-PMH/ })).toBeInTheDocument();
    const maintenance = screen.getByRole('group', { name: 'Hợp đồng bảo trì' });
    expect(within(maintenance).getByRole('option', { name: /MNT-E2E-UPS/ })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Phần mềm' })).queryByRole('option', { name: /SSL-E2E-PMH/ }),
    ).toBeNull();

    await user.click(within(domains).getByRole('option', { name: /SSL-E2E-PMH/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/domains/s1');
  });

  it('không khớp gì: có lối "Tìm … trong Tên miền & SSL"', async () => {
    stubFetch([]);
    const user = await openPalette();
    await user.type(screen.getByRole('combobox'), 'zzqq');
    await user.click(await screen.findByRole('option', { name: 'Tìm "zzqq" trong Tên miền & SSL' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/domains?q=zzqq');
  });
});
