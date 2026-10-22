import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, within } from '@/test/test-utils';
import { ProfileScreen } from './profile-screen';

const BASE = {
  id: 'u1',
  email: 'tv@pmh.com.vn',
  fullName: 'Thành viên E2E',
  role: 'member',
  features: ['assets', 'iso_0206'],
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'c',
} as unknown as Me;

function renderProfile(me: Me) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, []))));
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  return renderWithI18n(
    <MemoryRouter initialEntries={['/profile']}>
      <ToastProvider>
        <ConfirmProvider>
          <ProfileScreen me={me} />
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

/* UX-E33: Thành viên bị nhóm quyền giới hạn (Q-31) không có chỗ nào thấy mình được dùng mảng
   nào — chỉ thấy mục menu biến mất. */
describe('Hồ sơ — Quyền của tôi', () => {
  it('Thành viên có nhóm quyền: liệt kê đúng các mảng được dùng, theo tên menu', () => {
    renderProfile(BASE);
    const block = screen.getByRole('region', { name: 'Quyền của tôi' });
    expect(within(block).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Tài sản', 'Sự cố · 0206']);
  });

  it('Thành viên không bị giới hạn: một câu "mọi mảng"; Admin/SA không có khu này', () => {
    const view = renderProfile({ ...BASE, features: null } as Me);
    expect(within(screen.getByRole('region', { name: 'Quyền của tôi' })).getByText('Mọi mảng của Thành viên.')).toBeInTheDocument();
    view.unmount();
    renderProfile({ ...BASE, role: 'admin', features: null } as Me);
    expect(screen.queryByRole('region', { name: 'Quyền của tôi' })).toBeNull();
  });
});
