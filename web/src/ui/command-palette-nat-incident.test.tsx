import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * UX-E32 (Q-33): Tìm nhanh tra thêm luật NAT và số phiếu 0206 — "cổng 8443 mở cho máy nào",
 * "phiếu 0206-2026-004". Không thêm lệnh, không tra người dùng / nhà cung cấp.
 */

const me = { role: 'member', csrfToken: 'x', email: 'm@pmh.com.vn' } as unknown as Me;

const NAT = [
  {
    id: 'nat-1',
    deviceCode: 'FW-E2E-01',
    protocol: 'tcp',
    externalPorts: '8443',
    internalIp: '10.77.1.20',
    internalPort: 443,
    usedBy: 'Cổng web',
    voidedAt: null,
  },
];

const INCIDENTS = [{ id: 'inc-4', code: '0206-2026-004', severity: 'high', description: 'Job VSS lỗi' }];

function mockFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('/api/v1/ipam/nat')) return Promise.resolve(jsonResponse(200, NAT));
      if (url.startsWith('/api/v1/iso/incidents/find')) return Promise.resolve(jsonResponse(200, INCIDENTS));
      if (url.startsWith('/api/v1/ipam/addresses') || url.startsWith('/api/v1/ipam/subnets') || url.startsWith('/api/v1/diagrams')) {
        return Promise.resolve(jsonResponse(200, []));
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
  await user.type(screen.getByRole('combobox', { name: /tìm nhanh/i }), text);
}

describe('Tìm nhanh — Sổ NAT và phiếu 0206', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('luật NAT khớp: nhóm "Sổ NAT", dòng nói cổng → IP, mở sổ NAT tô đúng luật', async () => {
    const urls = mockFetch();
    await openAndType('8443');
    const group = await screen.findByRole('group', { name: 'Sổ NAT' });
    const hit = within(group).getByRole('option', { name: /TCP 8443 → 10\.77\.1\.20:443/ });
    expect(hit).toHaveTextContent('FW-E2E-01');
    expect(urls.some((u) => u.startsWith('/api/v1/ipam/nat?') && u.includes('search=8443'))).toBe(true);
  });

  it('số phiếu 0206 khớp: nhóm "Sự cố · 0206", dòng là số phiếu + mô tả', async () => {
    const urls = mockFetch();
    await openAndType('2026-004');
    const group = await screen.findByRole('group', { name: 'Sự cố · 0206' });
    const hit = within(group).getByRole('option', { name: /0206-2026-004/ });
    expect(hit).toHaveTextContent('Job VSS lỗi');
    expect(urls).toContain('/api/v1/iso/incidents/find?search=2026-004');
  });

  it('không có lệnh mới nào (Cấp IP, Xin mở két)', async () => {
    mockFetch();
    await openAndType('cấp');
    expect(screen.queryByRole('option', { name: /Cấp IP/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Xin mở két/ })).toBeNull();
  });
});
