import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { PATHS, isCompactShellPath, isEditorFocusPath } from '@/lib/routes';
import { AppShell } from '@/shell/app-shell';
import { ToastProvider } from '@/ui/toast';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

const ME: Me = {
  id: 'u-1',
  email: 'it@pmh.com.vn',
  fullName: 'Nguyễn Văn A',
  role: 'member',
  features: null,
  mustChangePassword: false,
  totpPending: false,
  totpEnrolled: true,
  steppedUpAt: null,
  csrfToken: 'tok',
  config: { stepUpGraceMinutes: 10, secretRevealSeconds: 30, fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 },
};

function renderShell(path: string) {
  return renderWithI18n(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <AppShell me={ME}>
                <p>Nội dung</p>
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"count":0}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const nav = () => screen.getByRole('navigation', { name: 'Điều hướng chính' });

describe('Sidebar tự thu trên màn sơ đồ (Q-23)', () => {
  it('đường sơ đồ là đường thu gọn; đường khác thì không', () => {
    expect(isCompactShellPath(PATHS.diagram('7b0c1c1e-0000-4000-8000-000000000001'))).toBe(true);
    // Cây bản vẽ là màn danh sách bình thường; chỉ màn mở MỘT bản vẽ mới cần bề ngang.
    expect(isCompactShellPath(PATHS.diagrams)).toBe(false);
    expect(isCompactShellPath(PATHS.devices)).toBe(false);
    expect(isCompactShellPath('/')).toBe(false);
  });

  it('vào màn sơ đồ: sidebar thu còn biểu tượng, mục vẫn có tên trợ năng + tooltip; nội dung tràn phần còn lại', () => {
    renderShell(PATHS.diagram('7b0c1c1e-0000-4000-8000-000000000001'));
    expect(nav()).toHaveAttribute('data-compact', 'true');
    const devices = screen.getByRole('link', { name: 'Thiết bị' });
    expect(devices).toHaveAttribute('title', 'Thiết bị');
    expect(screen.getByTestId('page-main')).toHaveAttribute('data-layout', 'full');
  });

  it('rời màn sơ đồ sang menu khác: sidebar mở rộng lại như bình thường', async () => {
    renderShell(PATHS.diagram('7b0c1c1e-0000-4000-8000-000000000001'));
    await userEvent.setup().click(screen.getByRole('link', { name: 'Thiết bị' }));
    expect(nav()).not.toHaveAttribute('data-compact');
    expect(screen.getByRole('link', { name: 'Thiết bị' })).not.toHaveAttribute('title');
    expect(screen.getByTestId('page-main')).not.toHaveAttribute('data-layout');
  });

  it('màn hẹp (điện thoại) mở một bản vẽ: sidebar là drawer như thường nhưng nội dung vẫn tràn hết chiều cao còn lại', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    renderShell(PATHS.diagram('7b0c1c1e-0000-4000-8000-000000000001'));
    expect(screen.getByTestId('page-main')).toHaveAttribute('data-layout', 'full');
  });

  it('màn thường không thu', () => {
    renderShell(PATHS.devices);
    expect(nav()).not.toHaveAttribute('data-compact');
  });
});

describe('Tab Sửa của bản vẽ trả chỗ cho trình vẽ (E-04)', () => {
  const EDIT = `${PATHS.diagram('7b0c1c1e-0000-4000-8000-000000000001')}?mode=edit`;

  it('đường sửa bản vẽ là đường "trần": chỉ khi đúng màn một bản vẽ + ?mode=edit', () => {
    expect(isEditorFocusPath(PATHS.diagram('x1'), '?mode=edit')).toBe(true);
    expect(isEditorFocusPath(PATHS.diagram('x1'), '')).toBe(false);
    expect(isEditorFocusPath(PATHS.diagrams, '?mode=edit')).toBe(false);
    expect(isEditorFocusPath(PATHS.devices, '?mode=edit')).toBe(false);
  });

  it('ở tab Sửa thanh trên cùng (nhóm, nút tìm, theme) ẩn; Ctrl+K vẫn mở Tìm nhanh', async () => {
    renderShell(EDIT);
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.getByTestId('page-main')).toHaveAttribute('data-chrome', 'bare');
    await userEvent.setup().keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('combobox', { name: /tìm nhanh/i })).toBeInTheDocument();
  });

  it('tab Xem vẫn có thanh trên cùng', () => {
    renderShell(PATHS.diagram('7b0c1c1e-0000-4000-8000-000000000001'));
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
