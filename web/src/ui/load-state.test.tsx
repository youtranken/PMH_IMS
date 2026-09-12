import { describe, it, expect, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { LoadError } from '@/ui/load-state';
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
