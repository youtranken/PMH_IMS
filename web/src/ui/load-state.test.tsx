import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { MemoryRouter } from 'react-router-dom';
import { DetailLoadFailed, Forbidden, LoadError, NotFound } from '@/ui/load-state';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

describe('LoadError', () => {
  it('không có lỗi trong tay thì giữ câu chung — không đoán bừa', () => {
    renderWithI18n(<LoadError error={undefined} onRetry={() => {}} />);
    expect(screen.getByText('Không tải được dữ liệu.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });

  it('bấm Thử lại gọi onRetry đúng 1 lần', async () => {
    const onRetry = vi.fn();
    renderWithI18n(<LoadError error={undefined} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  /*
   * Vế quan trọng nhất: API đã gửi một câu tiếng Việt nói rõ chuyện gì, và khối này phải in
   * ĐÚNG câu đó. Bản trước vứt nó đi — 38 chỗ gọi, bốn nguyên nhân, một câu chữ.
   */
  it('in đúng câu API gửi về, không phải câu chung', () => {
    const error = new ApiError(409, { message: 'Dải mạng đã hết IP trống.' });
    renderWithI18n(<LoadError error={error} onRetry={() => {}} />);
    expect(screen.getByText('Dải mạng đã hết IP trống.')).toBeInTheDocument();
    expect(screen.queryByText('Không tải được dữ liệu.')).not.toBeInTheDocument();
  });

  it('403 không có câu kèm → nói là thiếu quyền, không nói là lỗi tải', () => {
    renderWithI18n(<LoadError error={new ApiError(403, null)} onRetry={() => {}} />);
    expect(screen.getByText(/không có quyền/i)).toBeInTheDocument();
  });

  it('mất mạng (không phải ApiError) → nói là không kết nối được máy chủ', () => {
    renderWithI18n(<LoadError error={new TypeError('Failed to fetch')} onRetry={() => {}} />);
    expect(screen.getByText(/Không kết nối được máy chủ/i)).toBeInTheDocument();
  });

  it('khối lỗi là role=alert — trình đọc màn hình nghe được ngay, khỏi phải tab tới', () => {
    renderWithI18n(<LoadError error={undefined} onRetry={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('LoadError — chi tiết kỹ thuật', () => {
  it('500: câu chỉ đúng người vận hành, Thử lại cỡ thường, có mã HTTP để gửi kèm', () => {
    renderWithI18n(<LoadError error={new ApiError(502, null)} onRetry={() => {}} />);
    expect(screen.getByText(/gửi phần "Chi tiết kỹ thuật" bên dưới cho Super Admin/)).toBeInTheDocument();
    expect(screen.queryByText(/bộ phận IT/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Thử lại' })).not.toHaveClass('sm');
    expect(screen.getByText('Chi tiết kỹ thuật')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 502/)).toBeInTheDocument();
  });
});

describe('NotFound / Forbidden / DetailLoadFailed', () => {
  it('404 nói đường dẫn vừa mở; lối ra là link và nút RIÊNG, không lồng nhau', () => {
    renderWithI18n(
      <MemoryRouter initialEntries={['/khong-co']}>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByText('Đường dẫn /khong-co không tồn tại hoặc đã đổi.')).toBeInTheDocument();
    const home = screen.getByRole('link', { name: 'Về trang chủ' });
    expect(home.querySelector('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hoặc tìm nhanh/ })).toBeInTheDocument();
  });

  it('403 nói thẳng là thiếu quyền và trang dành cho ai — không giả là 404', () => {
    renderWithI18n(
      <MemoryRouter>
        <Forbidden roles={['sa', 'admin']} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Bạn không có quyền xem trang này' })).toBeInTheDocument();
    expect(screen.getByText(/Trang này dành cho Super Admin, Quản trị/)).toBeInTheDocument();
    expect(screen.queryByText('Không tìm thấy trang')).toBeNull();
  });

  it('chi tiết 404: vẫn có đường lùi + nút về danh sách, không có nút Thử lại', () => {
    renderWithI18n(
      <MemoryRouter>
        <DetailLoadFailed error={new ApiError(404, null)} onRetry={() => {}} backTo="/software" backLabel="Phần mềm" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Không tìm thấy hồ sơ' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về danh sách Phần mềm' })).toHaveAttribute('href', '/software');
    expect(screen.getByRole('link', { name: 'Phần mềm' })).toHaveAttribute('href', '/software');
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('chi tiết 500: vẫn có đường lùi + khối lỗi có Thử lại', () => {
    renderWithI18n(
      <MemoryRouter>
        <DetailLoadFailed error={new ApiError(500, null)} onRetry={() => {}} backTo="/software" backLabel="Phần mềm" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Phần mềm/ })).toHaveAttribute('href', '/software');
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
  });
});

