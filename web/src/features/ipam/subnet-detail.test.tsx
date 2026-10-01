import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import type { Me } from '@/lib/me';
import { SubnetPane } from './subnet-detail';
import type { SubnetRow } from './ipam-types';

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const SUBNET: SubnetRow = {
  id: 's1',
  name: 'LAN E2E',
  cidr: '10.0.1.0/29',
  siteId: null,
  siteCode: null,
  vlan: null,
  gateway: null,
  description: null,
  createdBy: 'sa@pmh.com.vn',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  total: 6,
  used: 1,
  free: 5,
  percent: 17,
  addressCount: 1,
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
};

const ASSIGNED = {
  kind: 'record',
  id: 'a1',
  subnetId: 's1',
  address: '10.0.1.3',
  deviceId: null,
  deviceCode: null,
  deviceName: null,
  usedBy: 'Chị Lan',
  assignedBy: 'sa@pmh.com.vn',
  assignedAt: '2026-09-01T00:00:00.000Z',
  status: 'assigned',
  note: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
};

describe('SubnetPane — menu ⋮ của một IP', () => {
  afterEach(() => vi.unstubAllGlobals());

  /* Q-19: thu hồi trả IP về pool và cấp lại được — việc đảo được thì màu cảnh báo, không đỏ. */
  it('"Thu hồi IP" tô màu cảnh báo, không phải đỏ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(jsonResponse(200, String(url).endsWith('/addresses') ? [ASSIGNED] : [])),
      ),
    );
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <SubnetPane subnet={SUBNET} me={ME} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const [kebab] = await screen.findAllByRole('button', { name: /Thao tác với 10\.0\.1\.3/ });
    await user.click(kebab);
    const reclaim = screen.getByRole('menuitem', { name: 'Thu hồi IP' });
    expect(reclaim).toHaveClass('warn');
    expect(reclaim).not.toHaveClass('danger');
  });

  it('nút xác nhận trong hộp "Thu hồi" cũng màu cảnh báo (caution), không đỏ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(jsonResponse(200, String(url).endsWith('/addresses') ? [ASSIGNED] : [])),
      ),
    );
    const user = userEvent.setup();
    renderWithI18n(
      <MemoryRouter>
        <ToastProvider>
          <SubnetPane subnet={SUBNET} me={ME} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const [kebab] = await screen.findAllByRole('button', { name: /Thao tác với 10\.0\.1\.3/ });
    await user.click(kebab);
    await user.click(screen.getByRole('menuitem', { name: 'Thu hồi IP' }));
    const dialog = await screen.findByRole('dialog');
    const submit = Array.from(dialog.querySelectorAll('button[type="submit"]'))[0];
    expect(submit).toHaveClass('caution');
    expect(submit).not.toHaveClass('danger');
  });
});
