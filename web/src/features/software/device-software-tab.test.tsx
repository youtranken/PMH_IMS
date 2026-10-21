import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { DeviceSoftwareTab } from './device-software-tab';
import type { SoftwareRow } from './software-types';

/**
 * Tab Phần mềm của trang thiết bị (Q-27): bảng license đang cài + "Gán phần mềm vào máy này" —
 * chọn license rồi đi đúng hộp Gán của phần mềm, máy này đã nằm sẵn trong lô (AD-15).
 */

afterEach(() => vi.unstubAllGlobals());

const OFFICE: SoftwareRow = {
  id: 'sw1',
  code: 'LIC-OFFICE-01',
  name: 'Office 2024',
  kind: 'license',
  licenseModel: 'perpetual',
  vendorId: null,
  vendorName: null,
  seatTotal: 5,
  seatUsed: 1,
  startDate: null,
  endDate: null,
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  autoRetireOn: null,
};

function mockFetch() {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const gets: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(jsonResponse(201, { id: 'a1', warnings: [] }));
      }
      gets.push(url);
      if (url.startsWith('/api/v1/software/installed/')) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith('/api/v1/software?')) return Promise.resolve(jsonResponse(200, { items: [OFFICE], total: 1 }));
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(jsonResponse(200, { vendors: [], sites: [], cabinets: [], deviceTypes: [], departments: [] }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    }),
  );
  return { posts, gets };
}

function render(canEdit = true) {
  return renderWithI18n(
    <ToastProvider>
      <DeviceSoftwareTab device={{ id: 'd1', code: 'PC-01' }} csrfToken="csrf" canEdit={canEdit} />
    </ToastProvider>,
  );
}

describe('Tab Phần mềm của thiết bị', () => {
  it('chọn license → hộp Gán của license đó, máy này nằm sẵn trong lô → gửi đúng deviceId', async () => {
    const { posts, gets } = mockFetch();
    render();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Gán phần mềm vào máy này' }));

    const pick = screen.getByRole('dialog', { name: 'Gán phần mềm — PC-01' });
    await user.type(within(pick).getByRole('combobox', { name: 'Tìm license' }), 'Office');
    await user.click(await screen.findByRole('option', { name: /LIC-OFFICE-01/ }));
    // Chỉ tìm license còn dùng — hồ sơ đã thanh lý không gán được.
    expect(gets.some((url) => url.startsWith('/api/v1/software?') && url.includes('kind=license') && url.includes('status=active'))).toBe(true);

    const assign = await screen.findByRole('dialog', { name: 'Gán license vào máy — LIC-OFFICE-01' });
    expect(within(assign).getByRole('list', { name: 'Máy sẽ gán' })).toHaveTextContent('PC-01');
    await user.click(within(within(assign).getByTestId('dialog-footer')).getByRole('button', { name: 'Gán vào máy' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ url: '/api/v1/software/sw1/assignments', body: { deviceId: 'd1' } });
  });

  it('máy đã thanh lý / người chỉ xem: không có nút gán', () => {
    mockFetch();
    render(false);
    expect(screen.queryByRole('button', { name: 'Gán phần mềm vào máy này' })).toBeNull();
  });
});
