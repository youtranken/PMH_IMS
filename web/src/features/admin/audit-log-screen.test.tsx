import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
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
      <ToastProvider>
        <AuditLogScreen />
        <Address />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Màn Nhật ký', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hiện dòng nhật ký: giờ VN, tên + email, nhãn + mã hành động, đối tượng, IP', async () => {
    stubFetch();
    renderAt('/admin/audit-log');

    expect(await screen.findByText('Lê Minh')).toBeInTheDocument();
    expect(screen.getByText('le.minh@pmh.com.vn')).toBeInTheDocument();
    // Nhãn tiếng Việt trước, mã kỹ thuật ở dòng phụ.
    expect(screen.getByText('Đăng nhập')).toBeInTheDocument();
    expect(screen.getByText('auth.login.ok', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(ROW.objectId)).toBeInTheDocument();
    expect(screen.getByText('10.0.0.8')).toBeInTheDocument();
    // 01:30 UTC = 08:30 giờ Việt Nam.
    expect(
      screen.getByText((text) => text.includes('20/09/2026') && text.includes('08:30'), {
        selector: 'button',
      }),
    ).toBeInTheDocument();
  });

  it('đối tượng có nhãn: "Loại · nhãn" là link tới hồ sơ, UUID còn trong tooltip + nút chép', async () => {
    const withLabel = {
      ...ROW,
      action: 'vault.secret.revealed',
      objectType: 'device',
      objectLabel: 'PC-KT-01 — Máy kế toán',
      objectPath: '/devices/abc',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).includes('/admin/audit/actions')
            ? jsonResponse(200, ['vault.secret.revealed', 'auth.login.ok'])
            : jsonResponse(200, { items: [withLabel], total: 1, totalCapped: false }),
        ),
      ),
    );
    renderAt('/admin/audit-log');

    const link = await screen.findByRole('link', { name: /PC-KT-01/ });
    expect(link).toHaveAttribute('href', '/devices/abc');
    expect(link).toHaveAttribute('title', ROW.objectId);
    expect(screen.getByRole('button', { name: 'Chép mã đối tượng' })).toBeInTheDocument();
    // Xem két tô màu cảnh báo — nhãn nằm trong huy hiệu `warn`.
    expect(screen.getByText('Xem mật khẩu trong két')).toHaveClass('badge', 'warn');
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

describe('Màn Nhật ký — chi tiết, lọc loại đối tượng, gọn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bấm dòng mở hộp chi tiết: bảng Trường · Trước · Sau và JSON gốc', async () => {
    const edited = {
      ...ROW,
      action: 'account.profile.updated',
      objectType: 'user',
      detail: { phone: { before: null, after: '0912 345 678' } },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).includes('/admin/audit/actions')
            ? jsonResponse(200, [])
            : jsonResponse(200, { items: [edited], total: 1, totalCapped: false }),
        ),
      ),
    );
    const user = userEvent.setup();
    renderAt('/admin/audit-log');
    await user.click(await screen.findByRole('button', { name: /Xem chi tiết dòng nhật ký lúc/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Số điện thoại');
    expect(dialog).toHaveTextContent('0912 345 678');
    expect(screen.getByRole('columnheader', { name: 'Trước' })).toBeInTheDocument();
    expect(screen.getByText('JSON gốc')).toBeInTheDocument();
  });

  it('?objectType= gửi lên API; nút Xuất Excel mang cùng bộ lọc', async () => {
    const fetchMock = stubFetch();
    renderAt('/admin/audit-log?objectType=user&q=le.minh');
    await screen.findByText('Lê Minh');
    expect(listCalls(fetchMock).at(-1)?.searchParams.get('objectType')).toBe('user');
    expect(screen.getByRole('button', { name: 'Xuất Excel' })).toBeInTheDocument();
  });

  it('lọc không ra thì câu rỗng có nút gỡ lọc', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).includes('/admin/audit/actions')
            ? jsonResponse(200, [])
            : jsonResponse(200, { items: [], total: 0, totalCapped: false }),
        ),
      ),
    );
    renderAt('/admin/audit-log?q=khong-ai');
    expect(await screen.findByRole('button', { name: 'Xóa bộ lọc' })).toBeInTheDocument();
  });

  it('sự kiện an ninh thất bại có vạch cảnh báo ở dòng', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).includes('/admin/audit/actions')
            ? jsonResponse(200, [])
            : jsonResponse(200, {
                items: [{ ...ROW, action: 'auth.login.failed' }],
                total: 1,
                totalCapped: false,
              }),
        ),
      ),
    );
    renderAt('/admin/audit-log');
    await screen.findByText('Lê Minh');
    expect(screen.getByText('Lê Minh').closest('tr')).toHaveClass('row-alert');
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

describe('Màn Nhật ký — gộp sự kiện lặp (ADM-065)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const BURST = {
    ...ROW,
    action: 'auth.login.failed',
    count: 3,
    firstAt: '2026-09-20T01:29:05.000Z',
    ip: '10.0.0.3',
    detail: { lan: 3 },
    createdAt: '2026-09-20T01:29:50.000Z',
    events: [
      { id: 'e3', ip: '10.0.0.3', detail: { lan: 3 }, createdAt: '2026-09-20T01:29:50.000Z' },
      { id: 'e2', ip: '10.0.0.2', detail: { lan: 2 }, createdAt: '2026-09-20T01:29:30.000Z' },
      { id: 'e1', ip: '10.0.0.1', detail: { lan: 1 }, createdAt: '2026-09-20T01:29:05.000Z' },
    ],
  };

  function stubBurst() {
    const fetchMock = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).includes('/admin/audit/actions')
          ? jsonResponse(200, [])
          : jsonResponse(200, { items: [BURST], total: 1, totalCapped: false }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('mặc định xin API gộp; bỏ tick "Gộp sự kiện lặp" thì xin từng dòng; file xuất không gộp', async () => {
    const fetchMock = stubBurst();
    const user = userEvent.setup();
    renderAt('/admin/audit-log');
    await screen.findByText('Lê Minh');
    expect(listCalls(fetchMock).at(-1)?.searchParams.get('group')).toBe('1');

    await user.click(screen.getByRole('checkbox', { name: 'Gộp sự kiện lặp' }));
    await waitFor(() => expect(listCalls(fetchMock).at(-1)?.searchParams.get('group')).toBeNull());
    expect(new URLSearchParams(screen.getByLabelText('địa chỉ').textContent ?? '').get('each')).toBe('1');
    expect(screen.getByRole('checkbox', { name: 'Gộp sự kiện lặp' })).not.toBeChecked();
  });

  it('dòng đã gộp mang ×N; hộp chi tiết liệt kê từng lần và mở được đúng lần đó', async () => {
    stubBurst();
    const user = userEvent.setup();
    renderAt('/admin/audit-log');
    expect((await screen.findAllByText('3 lần liền nhau')).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Xem chi tiết dòng nhật ký lúc/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('3 lần liền nhau — cùng người');
    const events = screen.getAllByRole('button', { name: /^Xem lần lúc/ });
    expect(events).toHaveLength(3);
    // Lần cũ nhất (mới nhất đứng trước) — hộp chuyển sang đúng lần đó, không còn danh sách cụm.
    await user.click(events[2]);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('10.0.0.1'));
    expect(screen.getByRole('dialog')).not.toHaveTextContent('3 lần liền nhau');
  });
});

