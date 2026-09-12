import { describe, expect, it, vi } from 'vitest';
import { Select } from '@/ui/select';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * Cửa bên cạnh của `Combobox`.
 *
 * Hai ô chọn dùng chung của repo này hở y hệt nhau: nơi gọi viết `options={lists.data?.x ?? []}`,
 * nên `/api/v1/catalog` hỏng là danh sách rỗng. `Select` còn nói thẳng ra một câu SAI —
 * "— Không có lựa chọn —" — đọc y như lúc chưa ai khai danh mục.
 *
 * Chỗ đau nhất là ô BẮT BUỘC ở form thêm mới (Loại thiết bị, Vị trí, Nhà mạng): người dùng
 * đọc "không có lựa chọn" rồi đi mở màn Danh mục để khai một loại thiết bị ĐÃ CÓ SẴN, hoặc
 * kết luận hệ thống chưa cài xong. Cả hai đều là hậu quả của việc component nói dối.
 *
 * Sửa ở `Combobox` mà quên `Select` chính là mẫu N1 đã lặp bốn lần trong repo — nên bài này
 * tồn tại để hai cửa không thể lệch nhau.
 */
describe('Select — phân biệt "không có lựa chọn" với "không tải được"', () => {
  const setup = (props: Partial<Parameters<typeof Select>[0]> = {}) => {
    const onChange = vi.fn();
    renderWithI18n(
      <Select value="" onChange={onChange} options={[]} ariaLabel="Loại thiết bị" {...props} />,
    );
    return { onChange };
  };

  it('failed: mở menu ra là thấy câu "không tải được", KHÔNG phải "không có lựa chọn"', async () => {
    setup({ failed: true });
    await userEvent.click(screen.getByRole('button', { name: 'Loại thiết bị' }));

    expect(screen.getByText('Không tải được danh sách. Thử lại sau.')).toBeInTheDocument();
    expect(screen.queryByText('— Không có lựa chọn —')).not.toBeInTheDocument();
  });

  it('failed: dòng báo lỗi không phải lựa chọn — Enter không gán nó vào form', async () => {
    const { onChange } = setup({ failed: true });
    const trigger = screen.getByRole('button', { name: 'Loại thiết bị' });
    await userEvent.click(trigger);

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    await userEvent.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  /** Vế đối chứng: rỗng THẬT vẫn phải nói "không có lựa chọn", không được kêu hỏng. */
  it('rỗng thật: giữ nguyên câu "— Không có lựa chọn —"', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Loại thiết bị' }));

    expect(screen.getByText('— Không có lựa chọn —')).toBeInTheDocument();
    expect(screen.queryByText('Không tải được danh sách. Thử lại sau.')).not.toBeInTheDocument();
  });

  it('có lựa chọn: chọn được như cũ, không dòng lỗi nào', async () => {
    const { onChange } = setup({ options: [{ value: 'pc', label: 'PC' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Loại thiết bị' }));

    expect(screen.queryByText('Không tải được danh sách. Thử lại sau.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: 'PC' }));
    expect(onChange).toHaveBeenCalledWith('pc');
  });
});

/**
 * DẤU `*` PHẢI CÓ NGHĨA VỚI CẢ NGƯỜI KHÔNG NHÌN THẤY NÓ (rà UI/UX #24).
 *
 * `Field required` chỉ VẼ dấu `*` (`page-header.tsx`), còn chặn thật thì tuỳ điều khiển bên
 * dưới: `<input>` có `required` của trình duyệt, `Select` render ra `<button>` nên KHÔNG có
 * gì. Hậu quả tới 12/09: năm ô đội dấu `*` mà trình đọc màn hình không nghe thấy chữ "bắt
 * buộc" nào — dấu ấy là thứ chỉ người sáng mắt đọc được.
 *
 * Vế đối chứng ở dưới cũng cần: `aria-required` trên MỌI ô chọn thì thuộc tính đó hết nghĩa.
 */
describe('Select — ô bắt buộc', () => {
  it('có `required` thì nút mở menu mang aria-required', () => {
    renderWithI18n(
      <Select required value="" onChange={() => {}} options={[]} ariaLabel="Loại thiết bị" />,
    );
    expect(screen.getByRole('button', { name: 'Loại thiết bị' })).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  it('không có `required` thì KHÔNG mang thuộc tính đó', () => {
    renderWithI18n(<Select value="" onChange={() => {}} options={[]} ariaLabel="Tủ mạng" />);
    expect(screen.getByRole('button', { name: 'Tủ mạng' })).not.toHaveAttribute('aria-required');
  });
});
