import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { useDisabledReason } from '@/ui/disabled-reason';
import { ImportDialog } from '@/ui/import-dialog';
import { ToastProvider } from '@/ui/toast';

/**
 * LÝ DO NÚT BỊ KHOÁ phải tới được trình đọc màn hình — không chỉ nằm trong `title=`.
 *
 * `title` chỉ hiện khi rê chuột, và phần lớn trình đọc màn hình không đọc nó cho nút đã có tên.
 * Người dùng bàn phím Tab tới một nút xám mà không nghe lý do thì kết luận "mình không có quyền".
 */
function ProbeButton({ reason, visible }: { reason: string | null; visible?: boolean }) {
  const { buttonProps, hint } = useDisabledReason(reason, { visible });
  return (
    <>
      {hint}
      <button type="button" disabled={reason !== null} {...buttonProps}>
        Xem
      </button>
    </>
  );
}

describe('useDisabledReason', () => {
  it('không có lý do → không gắn gì', () => {
    renderWithI18n(<ProbeButton reason={null} />);
    const button = screen.getByRole('button', { name: 'Xem' });
    expect(button).not.toHaveAttribute('aria-describedby');
    expect(button).not.toHaveAttribute('title');
  });

  it('có lý do → mô tả trợ năng + title; mặc định chỉ trình đọc màn hình thấy', () => {
    renderWithI18n(<ProbeButton reason="Đang mở một ngăn khác — xong sẽ bấm được." />);
    const button = screen.getByRole('button', { name: 'Xem' });
    expect(button).toHaveAccessibleDescription('Đang mở một ngăn khác — xong sẽ bấm được.');
    expect(button).toHaveAttribute('title', 'Đang mở một ngăn khác — xong sẽ bấm được.');
    expect(screen.getByText(/Đang mở một ngăn khác/)).toHaveClass('sr-only');
  });

  it('visible → câu lý do là chữ thường thấy được', () => {
    renderWithI18n(<ProbeButton reason="Chọn file trước." visible />);
    expect(screen.getByText('Chọn file trước.')).not.toHaveClass('sr-only');
  });
});

describe('ImportDialog — nút xám nói lý do qua aria-describedby', () => {
  function renderDialog() {
    return renderWithI18n(
      <ToastProvider>
        <ImportDialog
          title="Nhập danh mục"
          hint="File mẫu có bốn sheet."
          previewUrl="/preview"
          commitUrl="/commit"
          csrfToken="tok"
          mapRow={() => ({ group: 'x', rowNumber: 1, action: 'create', label: 'x' })}
          onClose={vi.fn()}
          onImported={vi.fn()}
        />
      </ToastProvider>,
    );
  }

  it('chưa chọn file → "Đối chiếu" xám và mô tả là phải chọn file', () => {
    renderDialog();
    const check = screen.getByRole('button', { name: 'Đối chiếu' });
    expect(check).toBeDisabled();
    expect(check).toHaveAccessibleDescription('Chọn file .xlsx trước đã.');
    // Mô tả phải đến từ một phần tử thật, không phải từ `title` (trình đọc màn hình hay bỏ qua).
    expect(check).toHaveAttribute('aria-describedby');
  });

  it('chưa đối chiếu → "Xác nhận ghi" xám, lý do đọc được VÀ nhìn thấy được', () => {
    renderDialog();
    const commit = screen.getByRole('button', { name: 'Xác nhận ghi' });
    expect(commit).toBeDisabled();
    expect(commit).toHaveAccessibleDescription(/Bấm "Đối chiếu" trước/);
    expect(commit).toHaveAttribute('aria-describedby');
    expect(screen.getByText(/Bấm "Đối chiếu" trước/)).toBeVisible();
  });
});
