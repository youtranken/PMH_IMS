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
 * Sửa `Combobox` mà quên `Select` là lỗi dễ lặp (`failed`, `optionsLoadError`, hàng rào NAT
 * đều từng như thế). Đặt chung một bài để hai cửa không lệch nhau được.
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

/**
 * DÒNG CHỌN KHÔNG ĐƯỢC NẰM TRONG VÒNG TAB.
 *
 * ===== VÌ SAO =====
 *
 * Mẫu `aria-activedescendant` (thứ hai bài trên vừa dựng xong) có một điều kiện kèm theo:
 * tiêu điểm DOM ở NGUYÊN trên ô gõ / nút mở, và các dòng chọn nằm NGOÀI vòng Tab. Dòng chọn
 * ở đây là `<button>` — mặc định `tabindex=0` — nên hiện tại có HAI thứ cùng nhận tiêu điểm
 * cho một quan hệ.
 *
 * Hậu quả không dừng ở lý thuyết: menu portal vào điểm neo của `dialog.tsx`, và điểm neo đó
 * là con CUỐI của `RD.Content` — sau cả `.sheet-footer`. Nên trong một form đang mở menu, gõ
 * Tab đưa tiêu điểm xuống các dòng chọn, ĐỨNG SAU cả nút Lưu và nút Hủy. Người dùng bàn phím
 * gõ Tab để tới nút Lưu và rơi vào giữa danh sách gợi ý.
 *
 * ===== CÂY TRỢ NĂNG =====
 *
 * `<ul role="listbox"> > <li> > <button role="option">` cho ra `listbox > listitem > option`:
 * `<li>` chen một tầng `listitem` vào giữa, thứ mà `listbox` không được phép chứa. `combo-error`
 * đã đặt `role="presentation"` đúng cho lý do này — hàng bọc dòng chọn thì chưa.
 */
describe('Dòng chọn nằm ngoài vòng Tab và không chen tầng lạ vào cây trợ năng', () => {
  it('Select: mọi option có tabindex=-1', async () => {
    renderWithI18n(
      <Select value="" onChange={vi.fn()} options={OPTIONS} ariaLabel="Loại thiết bị" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Loại thiết bị' }));

    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveAttribute('tabindex', '-1');
    }
  });

  it('Combobox: mọi option có tabindex=-1', async () => {
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
    await userEvent.click(screen.getByRole('combobox', { name: 'Thiết bị' }));

    for (const option of screen.getAllByRole('option')) {
      expect(option).toHaveAttribute('tabindex', '-1');
    }
  });

  it('Select: trong listbox không còn hàng nào mang vai listitem', async () => {
    renderWithI18n(
      <Select value="" onChange={vi.fn()} options={OPTIONS} ariaLabel="Loại thiết bị" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Loại thiết bị' }));

    const list = screen.getByRole('listbox');
    expect(list.querySelectorAll('li:not([role])')).toHaveLength(0);
  });

  it('Combobox: trong listbox không còn hàng nào mang vai listitem', async () => {
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
        action={{ label: 'Thêm thiết bị mới', onClick: vi.fn() }}
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Thiết bị' }));

    const list = screen.getByRole('listbox');
    expect(list.querySelectorAll('li:not([role])')).toHaveLength(0);
  });

  it('Combobox: dòng hành động vẽ dấu + bằng hình (aria-hidden), tên nút là đúng câu chữ', async () => {
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
        action={{ label: 'Thêm thiết bị mới', onClick: vi.fn() }}
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Thiết bị' }));
    const action = screen.getByRole('button', { name: 'Thêm thiết bị mới' });
    expect(action.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  /**
   * "ĐANG SÁNG" KHÔNG PHẢI "ĐÃ CHỌN".
   *
   * `Combobox` đang đặt `aria-selected={i === active}`, tức mỗi lần bấm ↓ là trình đọc màn
   * hình nghe "đã chọn" cho một dòng người dùng mới chỉ lướt qua — trong khi ô gõ vẫn chưa
   * nhận giá trị nào. Việc "đang sáng" ĐÃ được `aria-activedescendant` nói ra rồi; nói thêm
   * lần nữa bằng một từ có nghĩa khác là nói sai.
   *
   * `Select` làm đúng (`o.value === value`) vì nó CÓ giá trị đang chọn. `Combobox` là ô gõ tự
   * do, danh sách gợi ý của nó không mang lựa chọn nào cả — nên mọi dòng đều `false`.
   */
  it('Combobox: dòng đang sáng KHÔNG bị đánh dấu aria-selected', async () => {
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
    await userEvent.keyboard('{ArrowDown}');

    const options = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
    for (const option of options) {
      expect(option).toHaveAttribute('aria-selected', 'false');
    }
  });

  /** Vế đối chứng: `Select` CÓ giá trị đang chọn, và nó phải tiếp tục nói ra. */
  it('Select: chỉ dòng ĐÚNG giá trị đang chọn mới aria-selected=true', async () => {
    renderWithI18n(
      <Select value="laptop" onChange={vi.fn()} options={OPTIONS} ariaLabel="Loại thiết bị" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Loại thiết bị' }));

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[2]).toHaveAttribute('aria-selected', 'false');
  });
});
