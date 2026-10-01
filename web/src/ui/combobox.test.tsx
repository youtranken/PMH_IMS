import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Combobox } from '@/ui/combobox';
import { Dialog } from '@/ui/dialog';
import { SuggestInput } from '@/ui/suggest-input';
import { act, fireEvent, renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * "KHÔNG TÌM THẤY" và "KHÔNG HỎI ĐƯỢC" là hai câu khác nhau.
 *
 * Mọi ô chọn trong repo này đều truyền `options={q.data?.items ?? []}`. Khi API tìm kiếm hỏng,
 * `?? []` biến một lỗi 500 thành một danh sách rỗng, và ô chọn im lặng — người dùng đọc sự im
 * lặng đó thành "hệ thống không có thiết bị này".
 *
 * Hậu quả không phải "trải nghiệm kém", mà là DỮ LIỆU SAI:
 *   - Ô chọn thiết bị ở form NAT / cấp IP / gán license: không thấy máy đang có → khai một máy
 *     mới trùng, hoặc chọn đại một máy khác. Cả hai đều ghi vào DB và không tự sửa được.
 *   - Ô "người/bộ phận dùng": không thấy gợi ý → mỗi người gõ một kiểu ("P. Kế toán" /
 *     "Phòng Kế toán" / "KT"), đúng cái mà chú thích của `SuggestInput` nói nó sinh ra để tránh.
 *
 * Hàng rào nằm ở component DÙNG CHUNG chứ không ở từng nơi gọi: sửa ở 5 nơi gọi thì nơi thứ
 * sáu — viết sau, bởi người khác — lại hở, và hở trong im lặng.
 */
describe('Combobox — phân biệt "không có" với "không tải được"', () => {
  const setup = (props: Partial<Parameters<typeof Combobox<string>>[0]> = {}) => {
    const onSelect = vi.fn();
    renderWithI18n(
      <Combobox
        placeholder="Tìm thiết bị"
        ariaLabel="Tìm thiết bị"
        query=""
        onQuery={() => {}}
        options={[]}
        getKey={(option) => option}
        renderOption={(option) => <span>{option}</span>}
        onSelect={onSelect}
        {...props}
      />,
    );
    return { onSelect };
  };

  it('failed: chạm vào ô là thấy ngay câu "không tải được", không phải sự im lặng', async () => {
    setup({ failed: true });
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByText('Không tải được danh sách. Thử lại sau.')).toBeInTheDocument();
  });

  it('failed: dòng báo lỗi KHÔNG phải một lựa chọn — Enter không chọn nhầm nó', async () => {
    const { onSelect } = setup({ failed: true });
    const input = screen.getByRole('combobox');
    await userEvent.click(input);

    /*
     * Dòng lỗi phải nằm ngoài `role="option"`. Nếu nó là một option thì trình đọc màn hình
     * đọc nó lên như một thiết bị có thật, và ↓+Enter gán nó vào form.
     */
    expect(screen.queryAllByRole('option')).toHaveLength(0);

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('failed + vẫn còn dữ liệu cũ trong cache: hiện CẢ hai — cảnh báo lẫn lựa chọn', async () => {
    // Refetch hỏng nhưng cache còn: giấu danh sách cũ đi là lấy mất thứ đang dùng được.
    const { onSelect } = setup({ failed: true, options: ['PC-001'] });
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByText('Không tải được danh sách. Thử lại sau.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'PC-001' }));
    expect(onSelect).toHaveBeenCalledWith('PC-001');
  });

  /**
   * Vế đối chứng. Không có bài này thì một bản sửa cẩu thả (luôn hiện dòng lỗi) cũng xanh ở
   * ba bài trên, và mọi ô chọn trong hệ thống đều kêu hỏng suốt ngày.
   */
  it('bình thường: không có dòng lỗi, danh sách chọn được như cũ', async () => {
    const { onSelect } = setup({ options: ['PC-001', 'PC-002'] });
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Không tải được danh sách. Thử lại sau.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith('PC-002');
  });

  it('rỗng thật (không hỏng): im lặng như cũ — "không có" thì không được kêu lỗi', async () => {
    setup({ options: [] });
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
  /*
   * ===== LỌC KHÔNG RA THÌ PHẢI NÓI RA =====
   *
   * Không có trạng thái rỗng thì lọc không ra, menu chỉ còn mỗi dòng `action` (hoặc trống
   * hẳn). Người dùng gõ một từ, nhìn vào khoảng trống, và phải tự đoán — chưa khai? gõ sai?
   * hay hệ thống đang nghĩ? Câu trả lời (vd `nat.serviceEmpty` ở màn NAT) đi qua prop `empty`
   * và được vẽ bằng `.combo-empty` trong `form-layout.css`.
   *
   * Ba bài dưới đây khoá cả hình dạng lẫn VAI TRÒ của dòng ấy.
   */
  it('rỗng + có `empty`: hiện câu chỉ đường thay vì im lặng', async () => {
    setup({ empty: 'Chưa có dịch vụ nào khớp. Bấm "+ Thêm dịch vụ".' });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByText(/Chưa có dịch vụ nào khớp/)).toBeInTheDocument();
  });

  it('câu ấy KHÔNG phải một lựa chọn — ↓/Enter không chạm tới được', async () => {
    /*
     * Nếu nó mang `role="option"` thì trình đọc màn hình đọc ra một thiết bị CÓ THẬT, và
     * người dùng bấm Enter lên một câu giải thích. `role="presentation"` là đúng vai.
     */
    setup({ empty: 'Chưa có dịch vụ nào khớp.' });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('nguồn HỎNG thì ưu tiên câu báo hỏng, không nói "không có gì khớp"', async () => {
    /*
     * Hai chuyện khác hẳn nhau. Nói "không có gì khớp" khi thật ra không tải được là khẳng
     * định một điều chưa đọc được — đúng lớp lỗi mà cả file này sinh ra để chặn.
     */
    setup({ failed: true, empty: 'Chưa có dịch vụ nào khớp.' });
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.queryByText(/Chưa có dịch vụ nào khớp/)).not.toBeInTheDocument();
  });
});

describe('SuggestInput chuyển tiếp cờ hỏng', () => {
  it('danh mục bộ phận hỏng: ô gợi ý nói ra, không giả vờ là danh mục rỗng', async () => {
    renderWithI18n(
      <SuggestInput
        value=""
        onChange={() => {}}
        options={[]}
        failed
        placeholder="Người / bộ phận dùng"
        ariaLabel="Người / bộ phận dùng"
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByText('Không tải được danh sách. Thử lại sau.')).toBeInTheDocument();
  });
});

/**
 * ESC PHẢI ĐÓNG ĐƯỢC THẬT — KHÔNG BUNG LẠI SAU MỖI LẦN CHA RENDER.
 *
 * `options` gần như KHÔNG BAO GIỜ ổn định về identity ở nơi gọi thật: `SuggestInput` dựng
 * `filtered` bằng `useMemo([options, term])`, `use-departments.ts` trả `.filter().map()` —
 * mảng MỚI mỗi lượt gọi. Một effect nghe `[options]` vì thế chạy sau MỖI lần cha render, kể
 * cả khi nội dung y hệt.
 *
 * Cảnh thật (hộp Chuyển của `subnet-detail.tsx`): bấm ô "Người/bộ phận dùng" → menu bung →
 * Esc để dẹp nó đi → gõ tiếp vào ô "Lý do" → menu BUNG LẠI, đè lên đúng ô đang gõ. Người
 * dùng bấm Esc lần nữa, gõ tiếp, nó lại bung: không có cách nào đóng được nó bằng bàn phím.
 *
 * Chú thích trong `choose()` đã nhận ra đúng cơ chế này và vá bằng `touched = false` — nhưng
 * chỉ cho đường CHỌN. Đường Esc thì bỏ ngỏ.
 */
describe('Combobox — Esc đóng menu, cha render lại không được bung lại', () => {
  function Harness({ items }: { items: string[] }) {
    /* Ô thứ hai chỉ để BẮT CHƯỚC cha render lại — y như ô "Lý do" của hộp Chuyển. */
    const [reason, setReason] = useState('');
    return (
      <>
        <Combobox
          placeholder="Người / bộ phận dùng"
          ariaLabel="Người / bộ phận dùng"
          query=""
          onQuery={() => {}}
          /* Mảng MỚI mỗi lần render, nội dung KHÔNG đổi — đúng hình dạng của nơi gọi thật. */
          options={items.map((item) => item)}
          getKey={(item) => item}
          renderOption={(item) => <span>{item}</span>}
          onSelect={() => {}}
        />
        <label>
          Lý do
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </>
    );
  }

  it('Esc rồi gõ vào ô KHÁC: menu vẫn đóng', async () => {
    renderWithI18n(<Harness items={['Phòng Kế toán', 'Phòng Nhân sự']} />);

    await userEvent.click(screen.getByRole('combobox', { name: 'Người / bộ phận dùng' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();

    // Cha render lại (gõ một ký tự vào ô Lý do) → `options` đổi identity, nội dung y nguyên.
    await userEvent.type(screen.getByLabelText('Lý do'), 'x');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  /** Vế đối chứng: gõ vào CHÍNH ô gợi ý sau khi Esc thì menu PHẢI bung lại. */
  it('Esc rồi gõ tiếp vào chính ô gợi ý: menu bung lại', async () => {
    renderWithI18n(<Harness items={['Phòng Kế toán']} />);

    const input = screen.getByRole('combobox', { name: 'Người / bộ phận dùng' });
    await userEvent.click(input);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.type(input, 'k');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  /**
   * Cùng một effect còn `setActive(0)`: mỗi lần cha render là dòng đang sáng nhảy về đầu.
   * Bấm ↓ ba lần rồi cha render một cái là mất chỗ — với người dùng bàn phím thì đó là mất
   * hẳn khả năng chọn dòng thứ hai trở đi trên một form đang gõ.
   */
  it('cha render lại KHÔNG được kéo dòng đang sáng về đầu danh sách', async () => {
    renderWithI18n(<Harness items={['Phòng Kế toán', 'Phòng Nhân sự']} />);

    const input = screen.getByRole('combobox', { name: 'Người / bộ phận dùng' });
    await userEvent.click(input);
    await userEvent.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);

    /*
     * `fireEvent.change` chứ không phải `userEvent.type`: gõ bằng chuột-và-phím sẽ mousedown
     * ra ngoài ô gợi ý, và menu đóng vì lý do KHÁC (đúng hành vi, nhưng che mất thứ đang đo).
     * Ở đây cần đúng một thứ: cha render lại, không có tương tác nào chạm vào ô gợi ý.
     */
    fireEvent.change(screen.getByLabelText('Lý do'), { target: { value: 'x' } });

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1].id);
  });
});

/**
 * HAI LỖ KHÁC CỦA CÙNG Ô CHỌN NÀY.
 *
 * Cả hai cùng một gốc với docblock ở đầu file: component im lặng ở đúng chỗ người dùng cần
 * một câu trả lời. Ở trên là "không tải được"; ở đây là "đang tải" và "phím Enter".
 */
describe('Combobox — đang tải, và phím Enter khi lọc ra 0 dòng', () => {
  const OPTIONS = ['HTTP 80', 'HTTPS 443'];

  function renderIn(
    props: Partial<Parameters<typeof Combobox<string>>[0]> = {},
    onSubmit = vi.fn(),
  ) {
    renderWithI18n(
      <form onSubmit={onSubmit}>
        <Combobox
          placeholder="Tìm dịch vụ"
          ariaLabel="Tìm dịch vụ"
          query=""
          onQuery={() => {}}
          options={[]}
          getKey={(option) => option}
          renderOption={(option) => <span>{option}</span>}
          onSelect={vi.fn()}
          {...props}
        />
      </form>,
    );
    return { onSubmit };
  }

  /**
   * `Enter` KHÔNG được gọi `e.preventDefault()` VÔ ĐIỀU KIỆN.
   *
   * Lọc ra 0 dòng thì `options[active]` là `undefined`, không có gì để chọn — nhưng phím vẫn
   * bị nuốt. Người dùng gõ xong, bấm Enter để lưu phiếu, và KHÔNG CÓ GÌ XẢY RA: form không
   * submit, menu không nói gì, không một dòng giải thích. Họ bấm lại, vẫn không gì, rồi đi
   * tìm nút Lưu bằng chuột — hoặc kết luận là hệ thống treo.
   */
  it('lọc ra 0 dòng: Enter KHÔNG bị nuốt, form vẫn submit được', async () => {
    const { onSubmit } = renderIn({ empty: 'Không có dịch vụ nào khớp' });
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    await userEvent.type(box, '{Enter}');

    expect(onSubmit).toHaveBeenCalled();
  });

  it('CÓ dòng để chọn: Enter vẫn chọn dòng đó và KHÔNG submit (vế đối chứng)', async () => {
    // Vế này giữ cho bản vá không nới tay quá: Enter ở đây là "chọn", không phải "gửi form".
    const onSelect = vi.fn();
    const { onSubmit } = renderIn({ options: OPTIONS, onSelect });
    const box = screen.getByRole('combobox');
    await userEvent.click(box);
    await userEvent.type(box, '{Enter}');

    expect(onSelect).toHaveBeenCalledWith('HTTP 80');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /**
   * "Đang tải" và "không có gì khớp" không được đọc y hệt nhau.
   *
   * Trong lúc danh mục dịch vụ còn bay, `options` là `[]` và menu nói "Không có dịch vụ nào
   * khớp" kèm dòng "＋ Khai dịch vụ mới". Người dùng được MỜI đi khai trùng một dịch vụ đã
   * có — và cái khai trùng ấy vào DB, không tự sửa được.
   *
   * Cùng họ với `failed`: `failed` phân biệt "hỏng" với "rỗng"; `pending` phân
   * biệt "chưa biết" với "rỗng". Ba trạng thái, ba câu.
   */
  it('đang tải: KHÔNG nói "không có gì khớp", và KHÔNG mời khai mới', async () => {
    renderIn({
      pending: true,
      empty: 'Không có dịch vụ nào khớp',
      action: { label: '＋ Khai dịch vụ mới', onClick: vi.fn() },
    });
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.queryByText('Không có dịch vụ nào khớp')).not.toBeInTheDocument();
    expect(screen.queryByText('＋ Khai dịch vụ mới')).not.toBeInTheDocument();
    expect(screen.getByText('Đang tải…')).toBeInTheDocument();
  });

  it('tải xong mà rỗng thật: MỚI nói "không có gì khớp" (vế đối chứng)', async () => {
    renderIn({ pending: false, empty: 'Không có dịch vụ nào khớp' });
    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByText('Không có dịch vụ nào khớp')).toBeInTheDocument();
  });
});

/**
 * Hộp mở ra với `initialFocus="first-field"` đặt tiêu điểm vào ô gợi ý đầu tiên (ô Thiết bị
 * của hộp Cấp IP). Tiêu điểm do CODE đặt không phải người dùng chạm vào ô: menu bung ngay lúc
 * hộp hiện thì che các ô bên dưới, và phím Esc đầu tiên chỉ đóng menu — người dùng bấm Esc để
 * thoát hộp mà hộp vẫn đứng đó.
 */
describe('Combobox trong Dialog — tiêu điểm tự đặt không bung menu', () => {
  function setup() {
    const onOpenChange = vi.fn();
    renderWithI18n(
      <Dialog open onOpenChange={onOpenChange} title="Cấp IP" initialFocus="first-field">
        <Combobox
          placeholder="Thiết bị"
          ariaLabel="Thiết bị"
          query=""
          onQuery={() => {}}
          options={['SW-01', 'SW-02']}
          getKey={(item) => item}
          renderOption={(item) => <span>{item}</span>}
          onSelect={() => {}}
        />
      </Dialog>,
    );
    return { onOpenChange };
  }

  it('mở hộp: ô được focus nhưng menu CHƯA bung; Esc đóng được hộp', async () => {
    const { onOpenChange } = setup();
    const input = screen.getByRole('combobox', { name: 'Thiết bị' });
    expect(input).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /** Vế đối chứng: ô đã có tiêu điểm sẵn, bấm vào nó vẫn phải bung menu. */
  it('bấm vào ô đang có tiêu điểm sẵn: menu bung', async () => {
    setup();
    await userEvent.click(screen.getByRole('combobox', { name: 'Thiết bị' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

/**
 * Menu bung theo THAO TÁC của người dùng (bấm, gõ, ↓), không theo tiêu điểm. Tiêu điểm còn do
 * code đặt ở nhiều chỗ ngoài lúc hộp mở: hộp con đóng lại trả tiêu điểm về ô, FocusScope kéo
 * tiêu điểm về trong hộp… Mỗi lần như thế mà menu tự bung là nó che các ô bên dưới và nuốt
 * phím Esc đầu tiên người dùng bấm.
 */
describe('Combobox — tiêu điểm không phải thao tác', () => {
  function setup() {
    renderWithI18n(
      <>
        <button type="button">Trước</button>
        <Combobox
          placeholder="Thiết bị"
          ariaLabel="Thiết bị"
          query=""
          onQuery={() => {}}
          options={['SW-01', 'SW-02']}
          getKey={(item) => item}
          renderOption={(item) => <span>{item}</span>}
          onSelect={() => {}}
        />
      </>,
    );
    return screen.getByRole('combobox', { name: 'Thiết bị' });
  }

  it('code đặt tiêu điểm vào ô (vd hộp con đóng, trả tiêu điểm về): menu KHÔNG bung', () => {
    const input = setup();
    act(() => input.focus());
    expect(input).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('hộp con đóng lại trả tiêu điểm về ô chọn: menu KHÔNG bung', async () => {
    function Nested() {
      const [child, setChild] = useState(false);
      return (
        <Dialog open onOpenChange={() => {}} title="Cấp IP">
          <Combobox
            placeholder="Thiết bị"
            ariaLabel="Thiết bị"
            query=""
            onQuery={() => {}}
            options={['SW-01', 'SW-02']}
            getKey={(item) => item}
            renderOption={(item) => <span>{item}</span>}
            onSelect={() => {}}
          />
          <button type="button" onClick={() => setChild(true)}>
            Mở hộp con
          </button>
          {child ? (
            <Dialog open onOpenChange={() => setChild(false)} title="Hộp con">
              <button type="button" onClick={() => setChild(false)}>
                Xong
              </button>
            </Dialog>
          ) : null}
        </Dialog>
      );
    }
    renderWithI18n(<Nested />);
    await userEvent.click(screen.getByRole('button', { name: 'Mở hộp con' }));
    await userEvent.click(screen.getByRole('button', { name: 'Xong' }));
    act(() => screen.getByRole('combobox', { name: 'Thiết bị' }).focus());
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Tab vào ô: chưa bung; ↓ mới bung (bàn phím vẫn mở được)', async () => {
    const input = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Trước' }));
    await userEvent.tab();
    expect(input).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('bấm vào ô hoặc gõ: bung như cũ', async () => {
    const input = setup();
    await userEvent.click(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.type(input, 'S');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
