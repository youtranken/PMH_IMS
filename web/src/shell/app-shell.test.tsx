import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

const ME: Me = {
  id: 'u-1',
  email: 'it@pmh.com.vn',
  fullName: 'Nguyễn Văn A',
  role: 'admin',
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
};

function renderShell(path = '/') {
  return renderWithI18n(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <AppShell me={ME}>
                <p>Trang chủ</p>
              </AppShell>
            }
          />
          <Route path="/login" element={<p>Màn đăng nhập</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Đăng xuất nằm trong menu tài khoản ở chân sidebar. */
async function logoutViaMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /Menu tài khoản của Nguyễn Văn A/ }));
  await user.click(screen.getByRole('menuitem', { name: 'Đăng xuất' }));
}

describe('AppShell — menu tài khoản (SHELL-001)', () => {
  it('bấm tên → menu mở, tiêu điểm vào mục đầu, có đủ lối vào Hồ sơ / Đổi mật khẩu / 2 lớp / Giao diện / Đăng xuất', async () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: /Menu tài khoản của Nguyễn Văn A/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Hồ sơ của tôi' })).toHaveFocus();
    for (const name of ['Đổi mật khẩu', 'Xác thực 2 lớp', 'Đăng xuất']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
  });

  it('phím mũi tên đi vòng trong menu; Esc đóng và trả tiêu điểm về nút', async () => {
    renderShell();
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /Menu tài khoản của Nguyễn Văn A/ });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Đổi mật khẩu' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Đăng xuất' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('chọn "Tối" trong menu thì áp theme ngay và đánh dấu mục đó', async () => {
    renderShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Menu tài khoản của Nguyễn Văn A/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Tối/ }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('menuitemradio', { name: /Tối/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('Giao diện là MỘT hàng ba nút biểu tượng (Sáng · Tối · Theo hệ thống) có tên và tooltip; ←/→ đi trong hàng', async () => {
    renderShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Menu tài khoản của Nguyễn Văn A/ }));
    const group = screen.getByRole('group', { name: 'Giao diện' });
    const radios = within(group).getAllByRole('menuitemradio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Sáng', 'Tối', 'Theo hệ thống']);
    for (const radio of radios) {
      expect(radio.querySelector('svg')).not.toBeNull();
      expect(radio).toHaveAttribute('title', radio.getAttribute('aria-label'));
      // Không còn dấu ✓ bằng chữ: trạng thái chọn nằm ở aria-checked + kiểu nút.
      expect(radio.textContent).toBe('');
    }
    radios[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(radios[1]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(radios[0]).toHaveFocus();
  });
});

describe('AppShell — đăng xuất', () => {
  it('đăng xuất lỗi (mất mạng) → vẫn về màn đăng nhập VÀ báo lỗi cho người dùng', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderShell();
    await logoutViaMenu();
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(await screen.findByText(/Máy chủ chưa nhận lệnh đăng xuất/)).toBeInTheDocument();
  });

  it('đăng xuất thành công → về màn đăng nhập, không có toast lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' })));
    renderShell();
    await logoutViaMenu();
    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(screen.queryByText(/Máy chủ chưa nhận lệnh đăng xuất/)).not.toBeInTheDocument();
  });
});

describe('AppShell — topbar', () => {
  /*
   * Tên màn đã là `<h1>` của chính trang (PageHeader) — topbar nhắc lại lần nữa thì người dùng
   * đọc cùng một chữ hai lần ngay đầu màn (Q-18).
   */
  it('topbar KHÔNG lặp tên màn; chỉ có tên NHÓM làm ngữ cảnh; có ô tìm kèm phím tắt', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    renderShell('/devices');
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByText('Thiết bị')).toBeNull();
    expect(within(banner).getByTestId('topbar-context')).toHaveTextContent(/^Tài sản$/);
    expect(within(banner).queryByText(/Nguyễn Văn A/)).toBeNull();
    const search = within(banner).getByRole('button', { name: /^Tìm nhanh \((Ctrl K|⌘K)\)$/ });
    expect(search).toHaveTextContent('Tìm mã, tên, serial, IP…');
  });

  it('trang chi tiết đội nhóm của danh sách nó thuộc về', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    renderShell('/devices/d-9');
    expect(within(screen.getByRole('banner')).getByTestId('topbar-context')).toHaveTextContent(/^Tài sản$/);
  });

  it('màn không thuộc nhóm nào (Hồ sơ của tôi) thì topbar để trống, không đoán bừa', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    renderShell('/profile');
    expect(within(screen.getByRole('banner')).getByTestId('topbar-context')).toBeEmptyDOMElement();
  });

});


describe('AppShell — thương hiệu ở sidebar (Q-19)', () => {
  it('biểu tượng PMH (trang trí) đứng cạnh chữ "IMS"; không còn ô chữ IMS', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    const { container } = renderShell('/');
    const nav = screen.getByRole('navigation', { name: 'Điều hướng chính' });
    const brand = nav.querySelector<HTMLElement>('.brand')!;
    expect(brand).toHaveTextContent(/^IMS$/);
    const emblem = brand.querySelector('img')!;
    expect(emblem.getAttribute('src')).toMatch(/pmh-emblem\.png$/);
    expect(emblem).toHaveAttribute('alt', '');
    expect(container.querySelector('.brand-mark')).toBeNull();
  });
});

describe('AppShell — menu gọn (Q-18)', () => {
  const nav = () => screen.getByRole('navigation', { name: 'Điều hướng chính' });
  const systemToggle = () => within(nav()).getByRole('button', { name: 'Hệ thống' });

  it('không còn mục "Tài liệu" — không link, không chữ', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    renderShell();
    expect(within(nav()).queryByText('Tài liệu')).toBeNull();
  });

  it('nhóm "Hệ thống" mặc định khép; bấm tiêu đề thì mở, và nhớ qua lần mở sau', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    const first = renderShell('/devices');
    const toggle = systemToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const region = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(region).not.toBeNull();
    expect(within(nav()).queryByRole('link', { name: 'Danh mục' })).toBeNull();

    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav()).getByRole('link', { name: 'Danh mục' })).toBeVisible();

    first.unmount();
    renderShell('/devices');
    expect(systemToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('các nhóm khác không khép được — chỉ "Hệ thống"', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    renderShell('/devices');
    expect(within(nav()).queryByRole('button', { name: 'Tài sản' })).toBeNull();
    expect(within(nav()).getByRole('link', { name: 'Thiết bị' })).toBeVisible();
  });

  it('đang ở một màn trong nhóm thì nhóm tự mở, dù mặc định khép', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    renderShell('/admin/catalog');
    expect(systemToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav()).getByRole('link', { name: 'Danh mục' })).toBeVisible();
  });

  it('localStorage bị chặn (trình duyệt khoá dữ liệu trang) thì menu vẫn dựng, nhóm khép', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { count: 0 })));
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    renderShell('/devices');
    expect(systemToggle()).toHaveAttribute('aria-expanded', 'false');
    spy.mockRestore();
  });
});
