import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
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

function renderAt(entry: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/vault/access/scopes')) return Promise.resolve(jsonResponse(200, SCOPES));
      if (url.includes('/vault/access')) return Promise.resolve(jsonResponse(200, RULES));
      return Promise.resolve(jsonResponse(200, { items: ACCOUNTS, total: ACCOUNTS.length }));
    }),
  );
  return renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <AccessMatrixScreen me={ME} />
      </ToastProvider>
    </MemoryRouter>,
  );
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

  it('SA/Admin không thành dòng trống: họ nằm trong khối "Có toàn quyền theo vai (2)"', async () => {
    renderAt('/admin/vault-access');
    expect(await screen.findByText('Có toàn quyền theo vai (2)')).toBeInTheDocument();
    // Danh sách thành viên chỉ có Thành viên.
    const list = screen.getByRole('navigation', { name: 'Danh sách thành viên' });
    expect(list).not.toHaveTextContent('Cao Thuấn');
    expect(list).toHaveTextContent('Nguyễn An');
  });

  it('"+ Thêm quyền" chỉ liệt kê nhóm người đó CHƯA có', async () => {
    renderAt('/admin/vault-access?user=u-binh');
    await userEvent.click(await screen.findByRole('button', { name: '+ Thêm quyền' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Thiết bị loại Switch');
    expect(dialog).not.toHaveTextContent('Chứng chỉ SSL');
  });
});
