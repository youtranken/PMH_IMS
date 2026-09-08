import { describe, expect, it, vi } from 'vitest';
import { Combobox } from '@/ui/combobox';
import { SuggestInput } from '@/ui/suggest-input';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

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
