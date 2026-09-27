import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { AuditLogScreen, detailLines } from './audit-log-screen';

const ROW = {
  id: 'r1',
  actor: 'le.minh@pmh.com.vn',
  actorName: 'Lê Minh',
  action: 'auth.login.ok',
  objectType: 'session',
  objectId: 'b7c1e0e2-0000-4000-8000-000000000001',
  ip: '10.0.0.8',
  detail: { method: 'password' },
  createdAt: '2026-09-20T01:30:00.000Z',
};

function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/admin/audit/actions')) {
      return Promise.resolve(jsonResponse(200, ['auth.login.ok']));
    }
    return Promise.resolve(jsonResponse(200, { items: [ROW], total: 1, totalCapped: false }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function listCalls(fetchMock: ReturnType<typeof stubFetch>): URL[] {
  return fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://x'))
    .filter((url) => url.pathname === '/api/v1/admin/audit');
}

function Address() {
  return <output aria-label="địa chỉ">{useLocation().search}</output>;
}

function renderAt(entry: string) {
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <AuditLogScreen />
      <Address />
    </MemoryRouter>,
  );
}

describe('Màn Nhật ký', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hiện dòng nhật ký: giờ VN, tên + email, mã hành động, đối tượng, IP', async () => {
    stubFetch();
    renderAt('/admin/audit-log');

    expect(await screen.findByText('Lê Minh')).toBeInTheDocument();
    expect(screen.getByText('le.minh@pmh.com.vn')).toBeInTheDocument();
    expect(screen.getByText('auth.login.ok', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(ROW.objectId)).toBeInTheDocument();
    expect(screen.getByText('10.0.0.8')).toBeInTheDocument();
    // 01:30 UTC = 08:30 giờ Việt Nam.
    expect(
      screen.getByText((text) => text.includes('20/09/2026') && text.includes('08:30')),
    ).toBeInTheDocument();
  });

  /*
   * Link trong thư cảnh báo (`UI_PATHS.auditLog` bên api) là `?q=<email>`. Bài này giữ hai
   * đầu khớp nhau: đổi khoá tìm của màn mà quên bên api thì nút trong thư mở ra một nhật ký
   * KHÔNG lọc — trông như chạy đúng mà trả lời sai câu hỏi.
   */
  it('`?q=` trên URL thành bộ lọc `actor` gửi API', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/audit-log?q=le.minh%40pmh.com.vn');

    await screen.findByText('Lê Minh');
    expect(listCalls(fetchMock).at(-1)?.searchParams.get('actor')).toBe('le.minh@pmh.com.vn');
  });

  it('lọc mã đối tượng ghi lên URL và gửi đi, trang về 1', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/audit-log?page=3');
    await screen.findByText('Lê Minh');

    const input = screen.getByRole('searchbox', { name: 'Mã đối tượng' });
    await userEvent.type(input, 'DM-0001{Enter}');

    await waitFor(() => {
      const search = new URLSearchParams(screen.getByLabelText('địa chỉ').textContent ?? '');
      expect(search.get('objectId')).toBe('DM-0001');
      expect(search.get('page')).toBeNull();
    });
    await waitFor(() => {
      const last = listCalls(fetchMock).at(-1);
      expect(last?.searchParams.get('objectId')).toBe('DM-0001');
      expect(last?.searchParams.get('page')).toBe('1');
    });
  });
});

describe('detailLines', () => {
  it.each([
    [null, []],
    [undefined, []],
    [{ method: 'password' }, ['method: password']],
    [{ n: 3, tags: ['a'] }, ['n: 3', 'tags: [\n "a"\n]']],
    ['chuỗi trần', ['"chuỗi trần"']],
  ])('%j → %j', (detail, expected) => {
    expect(detailLines(detail)).toEqual(expected);
  });
});
