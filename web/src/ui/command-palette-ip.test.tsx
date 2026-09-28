import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * SHELL-015 / DEV-013: Tìm nhanh tra được IP và dải mạng.
 *
 * "10.77.30.5 là máy nào" là câu hỏi hằng ngày của đội IT. Gõ IP thì nhóm "Địa chỉ IP" phải
 * đứng ĐẦU, kể cả khi địa chỉ ấy đang trống (vẫn phải chỉ ra dải chứa nó).
 */

const me = { role: 'member', csrfToken: 'x', email: 'm@pmh.com.vn' } as unknown as Me;

const SUBNETS = [
  { id: 'cam', name: 'Camera E2E', cidr: '10.77.30.0/28', vlan: 30, voidedAt: null },
  { id: 'lan', name: 'LAN văn phòng', cidr: '10.77.1.0/24', vlan: 20, voidedAt: null },
];

const HIT = {
  id: 'ip-1',
  subnetId: 'cam',
  address: '10.77.30.5',
  deviceId: 'd1',
  deviceCode: 'CAM-E2E-01',
  deviceName: 'Camera cổng',
  usedBy: null,
  status: 'assigned',
  subnetCidr: '10.77.30.0/28',
  subnetName: 'Camera E2E',
  subnetVlan: 30,
};

function mockFetch(ipHits: unknown[]) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('/api/v1/ipam/addresses')) return Promise.resolve(jsonResponse(200, ipHits));
      if (url.startsWith('/api/v1/ipam/subnets')) return Promise.resolve(jsonResponse(200, SUBNETS));
      if (url.startsWith('/api/v1/devices')) {
        return Promise.resolve(
          jsonResponse(200, { items: [{ id: 'd9', code: 'PC-10', name: 'Máy 10', siteCode: null }] }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }),
  );
  return urls;
}

async function openAndType(text: string) {
  const user = userEvent.setup();
  renderWithI18n(
    <MemoryRouter>
      <ConfirmProvider>
        <CommandPalette me={me} />
      </ConfirmProvider>
    </MemoryRouter>,
  );
  await user.keyboard('{Control>}k{/Control}');
  const input = screen.getByRole('combobox', { name: /tìm nhanh/i });
  if (text) await user.type(input, text);
  return input;
}

function groupNames(): string[] {
  return screen
    .getAllByRole('group')
    .map((group) => group.getAttribute('aria-label') ?? '');
}

describe('Tìm nhanh — Địa chỉ IP và Dải mạng', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('placeholder nhắc được tìm IP', async () => {
    mockFetch([]);
    const input = await openAndType('');
    expect(input).toHaveAttribute('placeholder', 'Tìm mã, tên, serial, IP…');
  });

  it('gõ một IP: nhóm "Địa chỉ IP" lên ĐẦU, dòng nói IP → máy · dải, mở thẳng đúng dòng', async () => {
    const urls = mockFetch([HIT]);
    await openAndType('10.77.30.5');
    const ipGroup = await screen.findByRole('group', { name: 'Địa chỉ IP' });
    expect(within(ipGroup).getByRole('option')).toHaveTextContent('IP 10.77.30.5');
    expect(within(ipGroup).getByRole('option')).toHaveTextContent('CAM-E2E-01');
    expect(within(ipGroup).getByRole('option')).toHaveTextContent('Camera E2E');
    await screen.findByRole('group', { name: 'Dải mạng' });
    expect(groupNames()[0]).toBe('Địa chỉ IP');
    expect(groupNames()[1]).toBe('Dải mạng');
    expect(urls.some((u) => u.includes('/api/v1/ipam/addresses?') && u.includes('10.77.30.5'))).toBe(
      true,
    );
  });

  it('IP đang trống (chưa có hồ sơ) vẫn chỉ ra dải chứa nó', async () => {
    mockFetch([]);
    await openAndType('10.77.30.9');
    const ipGroup = await screen.findByRole('group', { name: 'Địa chỉ IP' });
    const option = within(ipGroup).getByRole('option');
    expect(option).toHaveTextContent('IP 10.77.30.9');
    expect(option).toHaveTextContent('Trống');
    expect(option).toHaveTextContent('Camera E2E');
  });

  it('gõ tên dải hoặc VLAN: có nhóm "Dải mạng", đứng SAU nhóm thiết bị', async () => {
    mockFetch([]);
    await openAndType('vlan 20');
    const group = await screen.findByRole('group', { name: 'Dải mạng' });
    expect(within(group).getByRole('option')).toHaveTextContent('10.77.1.0/24');
  });

  it('gõ chữ thường: nhóm IP không chen lên trước thiết bị', async () => {
    mockFetch([HIT]);
    await openAndType('camera');
    await screen.findByRole('group', { name: 'Địa chỉ IP' });
    await screen.findByRole('group', { name: 'Thiết bị' });
    const names = groupNames();
    expect(names.indexOf('Thiết bị')).toBeLessThan(names.indexOf('Địa chỉ IP'));
    expect(names).toContain('Dải mạng');
  });
});
