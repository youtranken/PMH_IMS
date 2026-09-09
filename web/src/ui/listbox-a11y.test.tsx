import { describe, expect, it, vi } from 'vitest';
import { Combobox } from '@/ui/combobox';
import { Select } from '@/ui/select';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * ↑/↓ PHẢI NÓI ĐƯỢC THÀNH TIẾNG.
 *
 * ===== BẪY =====
 *
 * Cả `Select` lẫn `Combobox` portal menu ra NGOÀI cây DOM của nút/ô gõ (để thoát `overflow`
 * của `.sheet-body` và của bảng). Với chuột thì không sao. Với trình đọc màn hình thì chúng
 * là hai thứ rời nhau:
 *
 *   - `aria-expanded` báo "đã mở", nhưng "mở CÁI GÌ" không có câu trả lời — thiếu
 *     `aria-controls`, và quan hệ cha-con trong DOM thì đã bị portal cắt đứt.
 *   - ↑/↓ chỉ đổi lớp CSS `active`. Không có `aria-activedescendant` thì đó là một thay đổi
 *     hoàn toàn IM LẶNG: người dùng mù bấm mũi tên năm lần và nghe đúng năm lần không có gì.
 *
 * Nghĩa là cả cơ chế điều hướng bàn phím — thứ đã viết xong, đã chạy đúng — không tới được
 * đúng nhóm người dùng cần nó nhất.
 *
 * ===== VÌ SAO MỘT FILE CHO CẢ HAI =====
 *
 * Sửa `Combobox` mà quên `Select` là mẫu N1 đã lặp bốn lần trong repo (`failed`, `optionsLoad
 * Error`, hàng rào NAT, và chính hai ô này). Đặt chung một bài để hai cửa không lệch nhau
 * được nữa.
 */

const OPTIONS = [
  { value: 'pc', label: 'Máy để bàn' },
  { value: 'laptop', label: 'Máy xách tay' },
  { value: 'printer', label: 'Máy in' },
];

describe('Select — nút và danh sách phải nối được với nhau', () => {
  const open = async () => {
    renderWithI18n(
      <Select value="" onChange={vi.fn()} options={OPTIONS} ariaLabel="Loại thiết bị" />,
    );
    const trigger = screen.getByRole('button', { name: 'Loại thiết bị' });
    await userEvent.click(trigger);
    return trigger;
  };

  it('aria-controls trỏ ĐÚNG vào listbox đang mở', async () => {
    const trigger = await open();
    const list = screen.getByRole('listbox');
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
    expect(list.id).toBeTruthy();
  });

  it('đóng lại thì KHÔNG còn aria-controls trỏ vào phần tử không tồn tại', async () => {
    const trigger = await open();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.getAttribute('aria-controls')).toBeNull();
  });

  it('↑/↓ dời aria-activedescendant sang đúng dòng đang sáng', async () => {
    const trigger = await open();
    const options = screen.getAllByRole('option');

    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[0].id);
    await userEvent.keyboard('{ArrowDown}');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[1].id);
    await userEvent.keyboard('{ArrowDown}');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[2].id);
    // Chạm đáy thì đứng lại, không quay vòng — và cũng không trỏ ra ngoài danh sách.
    await userEvent.keyboard('{ArrowDown}');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[2].id);
    await userEvent.keyboard('{ArrowUp}');
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[1].id);
  });

  it('chọn xong TRẢ FOCUS về nút — Tab kế tiếp đi tiếp trong form, không nhảy về đầu trang', async () => {
    const trigger = await open();
    await userEvent.click(screen.getAllByRole('option')[1]);
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Combobox — ô gõ và danh sách phải nối được với nhau', () => {
  const open = async () => {
    renderWithI18n(
      <Combobox
        placeholder="Tìm thiết bị"
        query=""
        onQuery={vi.fn()}
        options={OPTIONS}
        getKey={(o) => o.value}
        renderOption={(o) => <span>{o.label}</span>}
        onSelect={vi.fn()}
        ariaLabel="Thiết bị"
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Thiết bị' });
    await userEvent.click(input);
    return input;
  };

  it('aria-controls trỏ ĐÚNG vào listbox đang mở', async () => {
    const input = await open();
    const list = screen.getByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBe(list.id);
    expect(list.id).toBeTruthy();
  });

  it('↑/↓ dời aria-activedescendant sang đúng dòng đang sáng', async () => {
    const input = await open();
    const options = screen.getAllByRole('option');

    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
    await userEvent.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
    await userEvent.keyboard('{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[0].id);
  });

  /**
   * Vế đối chứng: danh sách RỖNG mà vẫn mở (vì có dòng "tạo mới" hoặc dòng báo hỏng) thì
   * KHÔNG được trỏ activedescendant vào hư không — `aria-activedescendant` bắt buộc trỏ tới
   * một phần tử CÓ THẬT, sai thì trình đọc màn hình im luôn thay vì đọc dòng nào đó.
   */
  it('không có dòng chọn nào thì KHÔNG đặt aria-activedescendant', async () => {
    renderWithI18n(
      <Combobox
        placeholder="Tìm thiết bị"
        query=""
        onQuery={vi.fn()}
        options={[]}
        getKey={(o: { value: string }) => o.value}
        renderOption={() => null}
        onSelect={vi.fn()}
        ariaLabel="Thiết bị"
        failed
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Thiết bị' });
    await userEvent.click(input);

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
  });
});
