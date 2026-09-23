import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/lib/i18n';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { Combobox } from '@/ui/combobox';

/**
 * `Field` NỐI NHÃN, GỢI Ý VÀ LỖI VÀO CHÍNH Ô NHẬP (F-06).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `<label htmlFor>` có sẵn, nhưng `{children}` là ANH EM của `<label>` chứ không nằm trong nó,
 * nên phép nối chỉ thành khi nơi gọi tự khai `htmlFor` VÀ tự đặt cùng `id` lên ô. Đo 19/09:
 * **56 trên 145** chỗ gọi `<Field>` không truyền `htmlFor`, trong đó **8 chỗ** ô con cũng
 * không có tên trợ năng nào — hoàn toàn câm. Và `aria-describedby` = **0 lần trong cả
 * `web/src`**: `hint`/`error` là chữ nằm cạnh ô, không thuộc về ô nào.
 *
 * ===== VÌ SAO BÀI NÀY DỰNG THẬT TỪNG LOẠI ĐIỀU KHIỂN =====
 *
 * `Field` nối bằng cách gắn `id`/`aria-describedby` vào đứa con của nó. Đứa con nào KHÔNG
 * nhận hai prop ấy thì phép gắn **lặng lẽ không làm gì** — không lỗi biên dịch, không cảnh
 * báo, form vẫn dựng ra bình thường. Đó đúng là hình dạng lỗi mà cả đợt rà soát này đi dọn.
 *
 * Nên mỗi loại điều khiển được dựng THẬT rồi ĐO lại trên DOM. `Combobox` có ô riêng vì nó là
 * gốc rễ §6.4 gọi tên: trước 23/09 nó không nhận `id`, nên `htmlFor` về nguyên tắc không dùng
 * được với nó dù nơi gọi có khai đúng.
 */

function labelOf(name: string) {
  return screen.getByLabelText(name);
}

describe('Field — nối nhãn vào ô', () => {
  it('<input> trần: bấm nhãn là vào đúng ô, kể cả khi nơi gọi KHÔNG khai htmlFor', () => {
    render(
      <Field label="Mã hồ sơ">
        <input className="inp" />
      </Field>,
    );
    // `getByLabelText` khớp qua `htmlFor` ↔ `id`; không nối được thì nó ném.
    expect(labelOf('Mã hồ sơ').tagName).toBe('INPUT');
  });

  it('Select: nhãn trỏ vào chính nút mở menu', () => {
    render(
      <Field label="Trạng thái">
        <Select value="" onChange={() => {}} options={[{ value: 'a', label: 'A' }]} />
      </Field>,
    );
    expect(labelOf('Trạng thái')).toBeTruthy();
  });

  it('Combobox: nhãn trỏ vào ô nhập — gốc rễ mà §6.4 gọi tên', () => {
    render(
      <Field label="Router">
        <Combobox
          placeholder="Chọn hoặc gõ để lọc…"
          query=""
          onQuery={() => {}}
          options={[]}
          getKey={(o: string) => o}
          renderOption={(o: string) => o}
          onSelect={() => {}}
        />
      </Field>,
    );
    expect(labelOf('Router').getAttribute('role')).toBe('combobox');
  });

  it('nơi gọi đã tự khai `id` thì GIỮ NGUYÊN id ấy', () => {
    /*
     * Một ô đổi qua lại giữa `<input>` và `Select` tùy trạng thái (ô "IP trong" của form NAT)
     * khai `id` riêng để cả hai nhánh cùng một tên. Đè lên nó là phá đúng chỗ đã làm đúng.
     */
    render(
      <Field label="IP trong" htmlFor="nat-ip">
        <input className="inp" id="nat-ip-custom" />
      </Field>,
    );
    expect(screen.getByRole('textbox').id).toBe('nat-ip-custom');
  });
});

describe('Field — nối gợi ý và lỗi vào ô', () => {
  it('hint được nối bằng aria-describedby', () => {
    render(
      <Field label="Mật khẩu" hint="Tối thiểu 12 ký tự">
        <input className="inp" />
      </Field>,
    );
    const input = labelOf('Mật khẩu');
    const described = input.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toBe('Tối thiểu 12 ký tự');
  });

  it('lỗi VÀ gợi ý cùng lúc thì nối CẢ HAI, lỗi trước', () => {
    /*
     * Luật 12/09 của chính `Field`: lỗi và gợi ý không loại trừ nhau, vì gợi ý thường chính là
     * thứ nói cho người dùng biết viết thế nào cho đúng. Nối thiếu một vế là giấu đi đúng nửa
     * mà người ta cần — và trình đọc màn hình không có cách nào biết nửa kia tồn tại.
     */
    render(
      <Field label="Mật khẩu" hint="Tối thiểu 12 ký tự" error="Mật khẩu quá ngắn.">
        <input className="inp" />
      </Field>,
    );
    const ids = labelOf('Mật khẩu').getAttribute('aria-describedby')!.split(' ');
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[0])?.textContent).toBe('Mật khẩu quá ngắn.');
    expect(document.getElementById(ids[1])?.textContent).toBe('Tối thiểu 12 ký tự');
  });

  it('không có hint/error thì KHÔNG đẻ ra aria-describedby rỗng', () => {
    // `aria-describedby=""` hoặc trỏ vào một id không tồn tại còn tệ hơn không có: trình đọc
    // màn hình đọc lên một chuỗi rỗng, hoặc im lặng theo cách khác nhau tuỳ hãng.
    render(
      <Field label="Ghi chú">
        <input className="inp" />
      </Field>,
    );
    expect(labelOf('Ghi chú').getAttribute('aria-describedby')).toBeNull();
  });

  it('Select và Combobox cũng nhận được describedby', () => {
    const { unmount } = render(
      <Field label="Trạng thái" hint="Chọn một">
        <Select value="" onChange={() => {}} options={[]} />
      </Field>,
    );
    expect(labelOf('Trạng thái').getAttribute('aria-describedby')).toBeTruthy();
    unmount();

    render(
      <Field label="Router" error="Chưa chọn router.">
        <Combobox
          placeholder="Chọn hoặc gõ để lọc…"
          query=""
          onQuery={() => {}}
          options={[]}
          getKey={(o: string) => o}
          renderOption={(o: string) => o}
          onSelect={() => {}}
        />
      </Field>,
    );
    expect(labelOf('Router').getAttribute('aria-describedby')).toBeTruthy();
  });
});
