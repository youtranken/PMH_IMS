import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/ui/error-boundary';
import { afterLogout } from '@/lib/after-logout';
import { renderWithI18n, screen } from '@/test/test-utils';

function Boom(): never {
  throw new TypeError("Cannot read properties of undefined (reading 'status')");
}

describe('ErrorBoundary — FE-01: một màn hỏng không làm trắng cả app', () => {
  beforeEach(() => {
    // React in lỗi đã bắt ra console; tắt để đầu ra test sạch.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('con ném lỗi lúc render → hiện khối báo lỗi có lối thoát, không trắng trang', () => {
    renderWithI18n(
      <ErrorBoundary resetKey="/devices/1">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Màn này gặp lỗi khi hiển thị' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải lại trang' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Về trang chủ' })).toBeInTheDocument();
  });

  it('đổi resetKey (sang màn khác) thì gỡ lỗi và vẽ lại nội dung', () => {
    const { rerender } = renderWithI18n(
      <ErrorBoundary resetKey="/devices/1">
        <Boom />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="/software">
        <p>Màn phần mềm</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Màn phần mềm')).toBeInTheDocument();
  });
});

describe('afterLogout — FE-02: đăng xuất xoá dữ liệu đã tải khỏi bộ nhớ', () => {
  it('xoá sạch cache react-query rồi mới chuyển về màn đăng nhập', () => {
    const client = new QueryClient();
    client.setQueryData(['accounts'], [{ email: 'sep@pmh.com.vn' }]);
    client.setQueryData(['vault', 'meta'], { count: 3 });
    const navigate = vi.fn(() => {
      expect(client.getQueryCache().getAll()).toHaveLength(0);
    });
    afterLogout(client, navigate);
    expect(navigate).toHaveBeenCalledWith('/login');
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});
