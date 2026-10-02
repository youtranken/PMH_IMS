import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
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

describe('ConfirmDialog — gõ lại tên để xác nhận', () => {
  it('nút xác nhận chỉ bật khi gõ ĐÚNG tên; bấm được thì mới gọi onConfirm', async () => {
    const onConfirm = vi.fn();
    renderWithI18n(
      <ConfirmDialog
        title="Xoá vĩnh viễn — enable"
        message="Không có cách nào xem lại."
        confirmLabel="Xoá vĩnh viễn"
        danger
        typeToConfirm={{ expected: 'enable', label: 'Gõ lại tên ngăn: enable' }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Xoá vĩnh viễn' });
    expect(confirm).toBeDisabled();
    const input = screen.getByRole('textbox', { name: 'Gõ lại tên ngăn: enable' });
    await userEvent.type(input, 'enabl');
    expect(confirm).toBeDisabled();
    await userEvent.type(input, 'e ');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('ConfirmDialog — lựa chọn thứ ba', () => {
  /* Hộp "Chưa lưu thay đổi": Lưu / Bỏ thay đổi / Ở lại — ba lối ra, không phải hai. */
  it('extra là nút riêng giữa Hủy và nút xác nhận, bấm gọi onClick của nó', async () => {
    const extra = vi.fn();
    const confirm = vi.fn();
    renderWithI18n(
      <ConfirmDialog
        title="Chưa lưu thay đổi"
        message="Nhóm này còn thay đổi chưa lưu."
        confirmLabel="Lưu nhóm này"
        cancelLabel="Ở lại"
        extra={{ label: 'Bỏ thay đổi', onClick: extra }}
        onConfirm={confirm}
        onCancel={() => {}}
      />,
    );
    const footer = screen.getByTestId('dialog-footer');
    expect(Array.from(footer.querySelectorAll('button')).map((b) => b.textContent)).toEqual([
      'Ở lại',
      'Bỏ thay đổi',
      'Lưu nhóm này',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(extra).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('confirmDisabled tắt riêng nút xác nhận', () => {
    renderWithI18n(
      <ConfirmDialog
        title="t"
        message="m"
        confirmLabel="Lưu nhóm này"
        confirmDisabled
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Lưu nhóm này' })).toBeDisabled();
  });
});
