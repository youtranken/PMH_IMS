import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { IpLookup } from './ip-lookup';
import type { SubnetRow } from './ipam-types';

afterEach(() => vi.unstubAllGlobals());

const INVALID = 'Địa chỉ IP không hợp lệ: đủ 4 phần, mỗi phần là số 0–255.';

function setUp() {
  const fetch = vi.fn(() => Promise.resolve(jsonResponse(200, [])));
  vi.stubGlobal('fetch', fetch);
  renderWithI18n(
    <MemoryRouter>
      <IpLookup subnets={[] as SubnetRow[]} />
    </MemoryRouter>,
  );
  return fetch;
}

async function lookup(text: string) {
  const box = screen.getByRole('searchbox', { name: 'Tra IP hoặc máy…' });
  await userEvent.clear(box);
  await userEvent.type(box, `${text}{Enter}`);
}

/* Q-20: tra IP sai định dạng → khung đỏ có nút ✕ dưới ô, KHÔNG gọi tìm kiếm. */
describe('IpLookup — IP sai định dạng', () => {
  it.each(['172.16.1100.10', '256.1.1.1', '1.2.3', '10.0.0.010'])(
    '"%s" → khung đỏ, không gọi API',
    async (text) => {
      const fetch = setUp();
      await lookup(text);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(INVALID);
      expect(alert).toHaveClass('error');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('nút ✕ đóng khung lỗi', async () => {
    setUp();
    await lookup('256.1.1.1');
    await userEvent.click(await screen.findByRole('button', { name: 'Đóng thông báo' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"a.b.c.d" là chữ tự do → tìm theo máy/người, không báo sai IP', async () => {
    const fetch = setUp();
    await lookup('a.b.c.d');
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(String(fetch.mock.calls[0][0])).toContain('search=a.b.c.d');
    expect(screen.queryByText(INVALID)).toBeNull();
  });

  it('IP đúng mà không dải nào chứa → cũng là khung đỏ đóng được', async () => {
    setUp();
    await lookup('203.0.113.77');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không dải nào đang dùng chứa 203.0.113.77.');
    expect(alert).toHaveClass('error');
    expect(screen.getByRole('button', { name: 'Đóng thông báo' })).toBeInTheDocument();
  });
});
