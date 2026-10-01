import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import type { Me } from '@/lib/me';
import { AccessMatrixScreen } from './access-matrix-screen';

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const ACCOUNTS = [
  { id: 'u-sa', email: 'sa@pmh.com.vn', fullName: 'Cao Thuấn', role: 'sa' },
  { id: 'u-ad', email: 'ad@pmh.com.vn', fullName: 'Lê Quản Trị', role: 'admin' },
  { id: 'u-an', email: 'an@pmh.com.vn', fullName: 'Nguyễn An', role: 'member' },
  { id: 'u-binh', email: 'binh@pmh.com.vn', fullName: 'Trần Bình', role: 'member' },
];
const SCOPES = [
  { scopeType: 'software_kind', scopeRef: 'ssl', label: 'Phần mềm: Chứng chỉ SSL' },
  { scopeType: 'device_type', scopeRef: 't1', label: 'Thiết bị loại Switch' },
];
const RULES = [
  {
    id: 'r1',
    memberEmail: 'binh@pmh.com.vn',
    scopeType: 'software_kind',
    scopeRef: 'ssl',
    scopeLabel: 'Phần mềm: Chứng chỉ SSL',
    tier: 'whitelist',
    grantedBy: 'sa@pmh.com.vn',
    note: null,
  },
];

function renderAt(entry: string, me: Me = ME) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/vault/access/scopes')) return Promise.resolve(jsonResponse(200, SCOPES));
    if (url.includes('/vault/access/people')) return Promise.resolve(jsonResponse(200, ACCOUNTS));
    if (url.includes('/vault/access')) return Promise.resolve(jsonResponse(200, RULES));
    // `/accounts` chỉ SA: màn này mở cho cả Admin nên không được dựa vào nó.
    return Promise.resolve(
      jsonResponse(403, { code: 'FORBIDDEN_ROLE', message: 'Bạn không có quyền thực hiện thao tác này.' }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const view = renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <AccessMatrixScreen me={me} />
      </ToastProvider>
    </MemoryRouter>,
  );
  return { ...view, fetchMock };
}

describe('Quyền xem két sắt — theo người', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('?user= mở sẵn đúng người; thẻ quyền gom theo họ, chip "SSL · Xem thẳng"', async () => {
    renderAt('/admin/vault-access?user=u-binh');
    expect(await screen.findByRole('heading', { name: 'Trần Bình' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Phần mềm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chứng chỉ SSL: Xem thẳng/ })).toHaveTextContent(
      'Chứng chỉ SSL · Xem thẳng',
    );
    // Danh sách bên trái có số quyền của từng người.
    expect(screen.getByRole('button', { name: /Trần Bình.*1 quyền/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('Admin mở được màn: danh sách người lấy từ két, không gọi /accounts (chỉ SA)', async () => {
    const admin = { role: 'admin', csrfToken: 't', email: 'ad@pmh.com.vn' } as unknown as Me;
    const { fetchMock } = renderAt('/admin/vault-access', admin);
    const list = await screen.findByRole('navigation', { name: 'Danh sách thành viên' });
    expect(list).toHaveTextContent('Nguyễn An');
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('/api/v1/accounts'))).toBe(false);
  });

  it('SA/Admin không thành dòng trống: họ nằm trong khối "Có toàn quyền theo vai (2)"', async () => {
    renderAt('/admin/vault-access');
    expect(await screen.findByText('Có toàn quyền theo vai (2)')).toBeInTheDocument();
    // Danh sách thành viên chỉ có Thành viên.
    const list = screen.getByRole('navigation', { name: 'Danh sách thành viên' });
    expect(list).not.toHaveTextContent('Cao Thuấn');
    expect(list).toHaveTextContent('Nguyễn An');
  });

  it('người đã nghỉ (vô hiệu hóa) mặc định ẩn; tick "Hiện cả người đã nghỉ" thì hiện kèm nhãn', async () => {
    const withLeaver = [
      ...ACCOUNTS,
      { id: 'u-cu', email: 'cu@pmh.com.vn', fullName: 'Lý Đã Nghỉ', role: 'member', status: 'disabled' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/vault/access/scopes')) return Promise.resolve(jsonResponse(200, SCOPES));
        if (url.includes('/vault/access/people')) return Promise.resolve(jsonResponse(200, withLeaver));
        return Promise.resolve(jsonResponse(200, RULES));
      }),
    );
    renderWithI18n(
      <MemoryRouter initialEntries={['/admin/vault-access']}>
        <ToastProvider>
          <AccessMatrixScreen me={ME} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const list = await screen.findByRole('navigation', { name: 'Danh sách thành viên' });
    expect(list).not.toHaveTextContent('Lý Đã Nghỉ');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Hiện cả tài khoản đã vô hiệu hóa (1)' }));
    expect(list).toHaveTextContent('Lý Đã Nghỉ');
    expect(list).toHaveTextContent('Đã vô hiệu hóa');
    // Người đã nghỉ: huy hiệu đỏ như mọi trạng thái "đã ngừng" khác (Q-18), không xám nhạt.
    expect(within(list).getByText('Đã vô hiệu hóa')).toHaveClass('badge', 'danger');
  });

  it('gán một nhóm cho nhiều người: người đã có quyền hiện tầng hiện tại, tóm tắt tách thêm / đổi', async () => {
    renderAt('/admin/vault-access?view=matrix');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Gán "Phần mềm: Chứng chỉ SSL" cho nhiều người' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Đang: Xem thẳng');
    await userEvent.click(screen.getByRole('button', { name: 'Chọn tất cả' }));
    expect(dialog).toHaveTextContent('thêm quyền cho 1 người · đổi tầng của 1 người');
  });

  it('ô trên lưới dùng biểu tượng SVG, không emoji', async () => {
    renderAt('/admin/vault-access?view=matrix');
    const cell = await screen.findByRole('button', {
      name: 'Trần Bình — Phần mềm: Chứng chỉ SSL: Xem thẳng',
    });
    expect(cell.querySelector('svg')).not.toBeNull();
    expect(cell.textContent).not.toContain('✓');
  });

  // Dấu "+" dạng ký tự nằm theo đường cơ sở của chữ, lệch khỏi tâm nút — phải là SVG.
  it('nút gán ở tiêu đề cột và đầu dòng dùng dấu + SVG, không ký tự', async () => {
    renderAt('/admin/vault-access?view=matrix');
    const col = await screen.findByRole('button', { name: 'Gán "Phần mềm: Chứng chỉ SSL" cho nhiều người' });
    const row = screen.getByRole('button', { name: 'Gán quyền cho Trần Bình' });
    for (const button of [col, row]) {
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).not.toContain('+');
    }
  });

  /*
   * Bảng hai tầng tiêu đề (họ → nhóm): thiếu `scope` thì trình đọc màn hình không biết ô tiêu
   * đề nào áp cho ô nào, và đọc một ô quyền mà không kèm tên nhóm.
   */
  it('ma trận: tiêu đề cột có scope="col", tiêu đề họ có scope="colgroup"', async () => {
    renderAt('/admin/vault-access?view=matrix');
    await screen.findByRole('button', { name: 'Trần Bình — Phần mềm: Chứng chỉ SSL: Xem thẳng' });
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBeGreaterThan(2);
    for (const th of headers) {
      expect(['col', 'colgroup']).toContain(th.getAttribute('scope'));
    }
    const groups = headers.filter((th) => th.getAttribute('colspan'));
    expect(groups.length).toBeGreaterThan(0);
    for (const th of groups) expect(th).toHaveAttribute('scope', 'colgroup');
  });

  it('"+ Thêm quyền" chỉ liệt kê nhóm người đó CHƯA có', async () => {
    renderAt('/admin/vault-access?user=u-binh');
    await userEvent.click(await screen.findByRole('button', { name: '+ Thêm quyền' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Thiết bị loại Switch');
    expect(dialog).not.toHaveTextContent('Chứng chỉ SSL');
    // Câu giải thích hai tầng dài: nằm sau nút (i) cạnh nhãn, không thành dòng gợi ý dưới ô.
    expect(within(dialog).getByRole('button', { name: 'Giải thích: Tầng quyền' })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('phải xin và chờ duyệt');
  });
});
