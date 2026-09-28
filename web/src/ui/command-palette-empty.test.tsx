import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * Tìm nhanh không có ngõ cụt: mở ra là có "Mở gần đây" + "Đi tới"; không khớp gì thì có lối
 * "Tìm "x" trong …"; nhóm bị cắt thì nói còn bao nhiêu; phần khớp được tô.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function stubFetch(devices: unknown[], total = devices.length) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/devices')) return Promise.resolve(jsonResponse(200, { items: devices, total }));
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

describe('Tìm nhanh — trạng thái trống và không khớp', () => {
  it('chưa gõ gì: nhóm "Đi tới" liệt kê các màn, chọn được bằng phím', async () => {
    stubFetch([]);
    const user = await openPalette();
    const goto = screen.getByRole('group', { name: 'Đi tới' });
    expect(within(goto).getByRole('option', { name: /Thiết bị/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('mở một hồ sơ → lần sau nó nằm ở "Mở gần đây"', async () => {
    stubFetch([{ id: 'd1', code: 'SW-CORE-01', name: 'Switch lõi', siteCode: 'HN' }]);
    const user = await openPalette();
    await user.type(screen.getByRole('combobox'), 'core');
    await user.click(await screen.findByRole('option', { name: /SW-CORE-01/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/devices/d1');

    await user.keyboard('{Control>}k{/Control}');
    const recent = screen.getByRole('group', { name: 'Mở gần đây' });
    expect(within(recent).getByRole('option', { name: /SW-CORE-01/ })).toBeInTheDocument();
  });

  it('không khớp gì: có lối "Tìm "x" trong Thiết bị" mở danh sách với ô tìm đã điền', async () => {
    stubFetch([]);
    const user = await openPalette();
    await user.type(screen.getByRole('combobox'), 'zzqq');
    expect(await screen.findByText('Không có hồ sơ nào khớp "zzqq".')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Tìm "zzqq" trong Thiết bị' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/devices?q=zzqq');
  });

  it('nhóm bị cắt: dòng "Xem tất cả N" cuối nhóm; phần khớp được tô', async () => {
    stubFetch([{ id: 'd1', code: 'SW-CORE-01', name: 'Switch lõi', siteCode: 'HN' }], 23);
    const user = await openPalette();
    await user.type(screen.getByRole('combobox'), 'core');
    const group = await screen.findByRole('group', { name: 'Thiết bị' });
    expect(
      await within(group).findByRole('option', { name: /Xem tất cả 23 kết quả trong Thiết bị/ }),
    ).toBeInTheDocument();
    expect(within(group).getByText('CORE', { selector: 'mark' })).toBeInTheDocument();
  });
});
