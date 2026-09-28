import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { ConfirmDialog } from '@/ui/confirm-dialog';

describe('ConfirmDialog — ô tick phụ', () => {
  function renderWithCheckbox() {
    renderWithI18n(
      <ConfirmDialog
        title="Thanh lý — SW-E2E-CORE-01"
        message="Chuyển sang ĐÃ THANH LÝ?"
        confirmLabel="Thanh lý"
        danger
        checkbox={{
          label: 'Dọn hết thứ liên quan (không hoàn tác được)',
          hint: 'Thu hồi IP, gỡ rule NAT và trả ghế license.',
        }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
  }

  /*
   * Câu hệ quả là câu quan trọng nhất của hộp này ("không hoàn tác được"). Nó phải là một
   * dòng RIÊNG dưới nhãn, được xuống dòng — không dùng `.field-inline` (nowrap) vốn cắt nó ra
   * ngoài mép hộp.
   */
  it('gợi ý là khối riêng dưới nhãn, không nằm trong lớp nowrap', () => {
    renderWithCheckbox();
    const box = screen.getByRole('checkbox', { name: 'Dọn hết thứ liên quan (không hoàn tác được)' });
    const label = box.closest('label')!;
    expect(label).not.toHaveClass('field-inline');
    expect(label).toHaveClass('confirm-check');

    const hint = screen.getByText('Thu hồi IP, gỡ rule NAT và trả ghế license.');
    expect(hint).toHaveClass('confirm-check-hint');
    // Trình đọc màn hình đọc câu hệ quả như MÔ TẢ của ô tick, tên ô vẫn gọn.
    expect(box).toHaveAttribute('aria-describedby', hint.id);
  });

  it('không có hint thì không có mô tả thừa', () => {
    renderWithI18n(
      <ConfirmDialog
        title="Xác nhận"
        message="Chắc chưa?"
        confirmLabel="Đồng ý"
        checkbox={{ label: 'Nhớ lựa chọn' }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Nhớ lựa chọn' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });
});
