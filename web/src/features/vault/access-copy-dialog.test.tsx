import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import type { Me } from '@/lib/me';
import { AccessMatrixScreen } from './access-matrix-screen';

const ME = { role: 'sa', csrfToken: 't', email: 'sa@pmh.com.vn' } as unknown as Me;

const ACCOUNTS = [
  { id: 'u-sa', email: 'sa@pmh.com.vn', fullName: 'Cao Thuấn', role: 'sa' },
  { id: 'u-an', email: 'an@pmh.com.vn', fullName: 'Nguyễn An', role: 'member' },
  { id: 'u-binh', email: 'binh@pmh.com.vn', fullName: 'Trần Bình', role: 'member' },
  { id: 'u-chi', email: 'chi@pmh.com.vn', fullName: 'Lê Chi', role: 'member' },
];
const SCOPES = [
  { scopeType: 'software_kind', scopeRef: 'ssl', label: 'Phần mềm: Chứng chỉ SSL' },
  { scopeType: 'device_type', scopeRef: 't1', label: 'Thiết bị loại Switch' },
];
const rule = (id: string, memberEmail: string, scopeRef: string, tier: string) => {
  const scope = SCOPES.find((item) => item.scopeRef === scopeRef)!;
  return {
    id,
    memberEmail,
    scopeType: scope.scopeType,
    scopeRef,
    scopeLabel: scope.label,
    tier,
    grantedBy: 'sa@pmh.com.vn',
    note: null,
  };
};
// Bình có hai nhóm; An (người nhận) đã có sẵn Switch ở tầng KHÁC — phải được giữ nguyên.
const RULES = [
  rule('r1', 'binh@pmh.com.vn', 'ssl', 'whitelist'),
  rule('r2', 'binh@pmh.com.vn', 't1', 'whitelist'),
  rule('r3', 'an@pmh.com.vn', 't1', 'needs_approval'),
];

function renderAt(entry: string) {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Promise.resolve(jsonResponse(201, { id: 'new' }));
      }
      if (url.includes('/vault/access/people')) return Promise.resolve(jsonResponse(200, ACCOUNTS));
      if (url.includes('/vault/access/scopes')) return Promise.resolve(jsonResponse(200, SCOPES));
      if (url.includes('/vault/access')) return Promise.resolve(jsonResponse(200, RULES));
      return Promise.resolve(jsonResponse(200, { items: ACCOUNTS, total: ACCOUNTS.length }));
    }),
  );
  renderWithI18n(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <ConfirmProvider>
          <AccessMatrixScreen me={ME} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return posts;
}

describe('Quyền két — "Sao chép quyền từ…" (ADM-040)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chép đúng nhóm + tầng của đồng nghiệp, bỏ qua nhóm người nhận đã có', async () => {
    const posts = renderAt('/admin/vault-access?user=u-an');
    await userEvent.click(await screen.findByRole('button', { name: 'Sao chép quyền từ…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sao chép quyền két cho Nguyễn An' });

    // Lê Chi chưa có quyền nào → không có mặt trong ô chọn.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Đồng nghiệp' }));
    expect(screen.queryByRole('option', { name: /Lê Chi/ })).toBeNull();
    await userEvent.click(screen.getByRole('option', { name: 'Trần Bình (2 quyền)' }));

    expect(within(dialog).getByText('Sẽ gán 1 nhóm:')).toBeInTheDocument();
    expect(within(dialog).getByText('Phần mềm: Chứng chỉ SSL · Xem thẳng')).toBeInTheDocument();
    expect(within(dialog).getByText('Bỏ qua 1 nhóm người này đã có:')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Gán quyền' }));
    const confirm = await screen.findByRole('dialog', { name: 'Xác nhận cấp quyền' });
    expect(confirm).toHaveTextContent('Cấp cho Nguyễn An 1 nhóm quyền két giống Trần Bình');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Gán quyền' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      memberEmail: 'an@pmh.com.vn',
      scopeType: 'software_kind',
      scopeRef: 'ssl',
      tier: 'whitelist',
      note: 'Sao chép từ binh@pmh.com.vn',
    });
  });

  it('đường hỏng: chưa chọn đồng nghiệp thì báo lỗi, không ghi gì', async () => {
    const posts = renderAt('/admin/vault-access?user=u-an');
    await userEvent.click(await screen.findByRole('button', { name: 'Sao chép quyền từ…' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gán quyền' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Chọn một đồng nghiệp để sao chép.');
    expect(posts).toHaveLength(0);
  });
});
