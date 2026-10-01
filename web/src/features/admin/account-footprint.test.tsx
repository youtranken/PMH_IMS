import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { AccountFootprint } from './account-footprint';

const MEMBER = {
  id: 'u-1',
  fullName: 'Nguyễn An',
  email: 'an@pmh.com.vn',
  role: 'member' as const,
};

function stub(options: { devicesFail?: boolean } = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/vault/access?')) {
      return Promise.resolve(jsonResponse(200, [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]));
    }
    if (url.endsWith('/vault/break-glass/pending')) {
      return Promise.resolve(
        jsonResponse(200, [
          { id: 'p1', requester: 'AN@pmh.com.vn' },
          { id: 'p2', requester: 'khac@pmh.com.vn' },
        ]),
      );
    }
    if (url.includes('/devices?')) {
      return options.devicesFail
        ? Promise.resolve(jsonResponse(500, { message: 'hỏng' }))
        : Promise.resolve(jsonResponse(200, { items: [], total: 2 }));
    }
    return Promise.resolve(jsonResponse(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/*
 * Nghỉ việc mà quên gỡ quyền két, quên thu máy: hộp Vô hiệu hóa phải nói CON SỐ đang còn,
 * không chỉ một câu nhắc chung chung mà ai cũng bấm qua.
 */
describe('AccountFootprint — người này còn giữ gì', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('đếm quyền két, yêu cầu mở két đang chờ (so email không phân biệt hoa thường), thiết bị khớp tên', async () => {
    const fetchMock = stub();
    renderWithI18n(
      <MemoryRouter>
        <AccountFootprint account={MEMBER} />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('link', { name: '3 dòng quyền két sắt' })).toHaveAttribute(
      'href',
      '/admin/vault-access?user=u-1',
    );
    expect(await screen.findByRole('link', { name: '1 yêu cầu mở két đang chờ duyệt' })).toHaveAttribute(
      'href',
      '/approvals',
    );
    expect(await screen.findByRole('link', { name: '2 thiết bị đang ghi người này sử dụng' })).toHaveAttribute(
      'href',
      `/devices?q=${encodeURIComponent('Nguyễn An')}`,
    );
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes(`memberEmail=${encodeURIComponent(MEMBER.email)}`))).toBe(true);
    // Khớp ĐÚNG ô "Người sử dụng" và bỏ máy đã thanh lý — tìm chữ tự do đếm cả máy ghi chú tên
    // người này, và máy đã thanh lý thì không còn gì phải thu.
    const devicesUrl = new URL(urls.find((url) => url.includes('/devices?'))!, 'http://x');
    expect(devicesUrl.searchParams.get('assignedTo')).toBe('Nguyễn An');
    expect(devicesUrl.searchParams.get('status')).toBe('live');
    expect(devicesUrl.searchParams.has('search')).toBe(false);
  });

  it('Quản trị/SA: không hỏi quyền két (xem theo vai), nói rõ điều đó', async () => {
    const fetchMock = stub();
    renderWithI18n(
      <MemoryRouter>
        <AccountFootprint account={{ ...MEMBER, role: 'admin' }} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Xem mọi két theo vai — không có dòng quyền riêng.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/vault/access?'))).toBe(false);
  });

  it('một nguồn hỏng: nói không đếm được, vẫn để link kiểm tay — không in số 0', async () => {
    stub({ devicesFail: true });
    renderWithI18n(
      <MemoryRouter>
        <AccountFootprint account={MEMBER} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('link', { name: 'Thiết bị đang ghi người này sử dụng (không đếm được)' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^0 thiết bị/)).not.toBeInTheDocument();
  });
});
