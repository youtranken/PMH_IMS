import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { CommandPalette } from '@/ui/command-palette';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { Me } from '@/lib/me';

/**
 * D-08: Tìm nhanh tìm được bản vẽ theo tên và "máy X nằm ở bản vẽ nào". Chỉ tên — nội dung bản
 * vẽ vẫn hỏi mã khi mở, nên palette không gọi route nào đòi mã sơ đồ.
 */

const me = { role: 'member', csrfToken: 'x', email: 'm@pmh.com.vn' } as unknown as Me;

const TREE = [
  { id: 'g1', parentId: null, name: 'Phú Mỹ Hưng E2E', nodeType: 'company', kind: 'official', archivedAt: null },
  { id: 'f3', parentId: 'g1', name: 'Tầng 3 Tower E2E', nodeType: 'floor', kind: 'official', archivedAt: null },
];
const FOUND = [{ id: 'dev1', code: 'SW-TANG3-E2E', name: 'Switch tầng 3', diagrams: [{ id: 'f3', name: 'Tầng 3 Tower E2E' }] }];

function mockFetch() {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('/api/v1/diagrams/find')) return Promise.resolve(jsonResponse(200, url.includes('tang3') || url.includes('SW') ? FOUND : []));
      if (url === '/api/v1/diagrams') return Promise.resolve(jsonResponse(200, TREE));
      if (url.startsWith('/api/v1/ipam/subnets')) return Promise.resolve(jsonResponse(200, []));
      if (url.startsWith('/api/v1/ipam/addresses')) return Promise.resolve(jsonResponse(200, []));
      return Promise.resolve(jsonResponse(200, { items: [] }));
    }),
  );
  return urls;
}

let where = '';
function Where() {
  const loc = useLocation();
  where = `${loc.pathname}${loc.search}`;
  return null;
}

async function openAndType(text: string) {
  const user = userEvent.setup();
  renderWithI18n(
    <MemoryRouter initialEntries={['/']}>
      <ConfirmProvider>
        <CommandPalette me={me} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>,
  );
  await user.keyboard('{Control>}k{/Control}');
  const input = screen.getByRole('combobox', { name: /tìm nhanh/i });
  await user.type(input, text);
  return user;
}

describe('Tìm nhanh — nhóm Sơ đồ (D-08)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gõ tên bản vẽ (không dấu): dòng bản vẽ mở thẳng bản vẽ đó', async () => {
    mockFetch();
    const user = await openAndType('tang 3');
    const group = await screen.findByRole('group', { name: 'Sơ đồ mạng' });
    const option = await within(group).findByRole('option', { name: /Tầng 3 Tower E2E/ });
    await user.click(option);
    expect(where).toBe('/diagrams/f3');
  });

  it('gõ mã máy: "máy → bản vẽ có máy đó", mở bản vẽ và bay tới máy; không gọi route đòi mã', async () => {
    const urls = mockFetch();
    const user = await openAndType('SW-TANG3');
    const group = await screen.findByRole('group', { name: 'Sơ đồ mạng' });
    const option = await within(group).findByRole('option', { name: /SW-TANG3-E2E/ });
    expect(option).toHaveTextContent('Tầng 3 Tower E2E');
    await user.click(option);
    expect(where).toBe('/diagrams/f3?focus=dev1');
    expect(urls.some((u) => /\/(content|versions|review)\b/.test(u))).toBe(false);
  });
});
