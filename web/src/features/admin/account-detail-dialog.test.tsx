import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { AccountDetailDialog, type AccountLockout } from './account-detail-dialog';

const ACCOUNT = { id: 'u-7', fullName: 'Trần Bình', email: 'binh@pmh.com.vn', role: 'member' as const };

function stub(lockouts: AccountLockout[]) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/accounts/u-7/lockouts')) return Promise.resolve(jsonResponse(200, lockouts));
    if (url.includes('/vault/access?')) return Promise.resolve(jsonResponse(200, []));
    if (url.endsWith('/break-glass/pending')) return Promise.resolve(jsonResponse(200, []));
    if (url.includes('/devices?')) return Promise.resolve(jsonResponse(200, { items: [], total: 0 }));
    return Promise.resolve(jsonResponse(404, {}));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderDialog(
  props: { onClearLockout?: () => void; onOpenSessions?: () => void; vaultAccessPath?: string } = {},
) {
  return renderWithI18n(
    <MemoryRouter>
      <AccountDetailDialog
        account={ACCOUNT}
        facts={[{ label: 'Email', value: ACCOUNT.email }]}
        onClose={() => {}}
        onEdit={() => {}}
        onOpenSessions={props.onOpenSessions ?? (() => {})}
        onClearLockout={props.onClearLockout}
        vaultAccessPath={props.vaultAccessPath}
      />
    </MemoryRouter>,
  );
}

/*
 * "Người này đang thế nào" trong MỘT hộp: hồ sơ, đang bị chặn từ IP nào, còn giữ gì, và lối
 * sang phiên / nhật ký — thay vì mở bốn năm chỗ.
 */
describe('AccountDetailDialog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('liệt kê từng IP đang chặn / đang đếm sai; có chặn thì có nút Gỡ tạm chặn', async () => {
    stub([
      { ip: '203.0.113.9', failedAttempts: 8, lockedUntil: '2026-09-29T08:35:00.000Z', updatedAt: '2026-09-29T07:35:00.000Z' },
      { ip: '192.0.2.44', failedAttempts: 2, lockedUntil: null, updatedAt: '2026-09-29T07:00:00.000Z' },
    ]);
    const onClearLockout = vi.fn();
    renderDialog({ onClearLockout });
    const dialog = await screen.findByRole('dialog', { name: 'Trần Bình' });
    expect(within(dialog).getByText('binh@pmh.com.vn')).toBeInTheDocument();
    const rows = (await within(dialog).findAllByRole('row')).map((row) => row.textContent);
    expect(rows).toEqual(['IPLần gõ saiChặn tới', '203.0.113.9829/09/2026 15:35', '192.0.2.442Chưa chặn']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gỡ tạm chặn' }));
    expect(onClearLockout).toHaveBeenCalledOnce();
  });

  it('không truyền onClearLockout (tài khoản đang Khóa) thì không có nút gỡ, dù đang chặn', async () => {
    stub([
      { ip: '203.0.113.9', failedAttempts: 8, lockedUntil: '2026-09-29T08:35:00.000Z', updatedAt: '2026-09-29T07:35:00.000Z' },
    ]);
    renderDialog();
    await screen.findByText('203.0.113.9');
    expect(screen.queryByRole('button', { name: 'Gỡ tạm chặn' })).not.toBeInTheDocument();
  });

  it('không bị chặn ở đâu thì nói thẳng; có lối sang phiên và hai kiểu nhật ký', async () => {
    stub([]);
    const onOpenSessions = vi.fn();
    renderDialog({ onOpenSessions });
    expect(await screen.findByText('Không bị tạm chặn ở đâu.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Việc người này đã làm' })).toHaveAttribute(
      'href',
      `/admin/audit-log?q=${encodeURIComponent('binh@pmh.com.vn')}`,
    );
    expect(screen.getByRole('link', { name: 'Nhật ký về tài khoản này' })).toHaveAttribute(
      'href',
      '/admin/audit-log?objectId=u-7',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Phiên đang mở' }));
    expect(onOpenSessions).toHaveBeenCalledOnce();
  });

  /* Q-21: lối sang Quyền két của một Thành viên chuyển từ menu dòng vào đây. */
  it('có vaultAccessPath thì có link Quyền két sắt; không có thì không', async () => {
    stub([]);
    const { unmount } = renderDialog({ vaultAccessPath: '/admin/vault-access?user=u-7' });
    expect(await screen.findByRole('link', { name: 'Quyền két sắt' })).toHaveAttribute(
      'href',
      '/admin/vault-access?user=u-7',
    );
    unmount();
    renderDialog();
    await screen.findByText('Không bị tạm chặn ở đâu.');
    expect(screen.queryByRole('link', { name: 'Quyền két sắt' })).not.toBeInTheDocument();
  });
});
