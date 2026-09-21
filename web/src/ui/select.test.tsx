import { act, useState } from 'react';
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

/**
 * F-05 — DÒNG ĐANG SÁNG KHÔNG ĐƯỢC NHẢY VỀ CHỖ CŨ KHI CHA RENDER LẠI.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Effect "mở → sáng dòng đang chọn" nghe `[open, options, value]`. `options` gần như KHÔNG
 * BAO GIỜ ổn định về identity ở nơi gọi thật: các màn viết `options={lists.data?.x ?? []}`,
 * `.filter().map()`, hoặc `useMemo` phụ thuộc một ô đang gõ — mảng MỚI sau mỗi lượt cha
 * render, kể cả khi nội dung y hệt.
 *
 * Nên trong lúc menu ĐANG MỞ, bất kỳ lượt cha render nào cũng chạy lại effect và kéo dòng
 * sáng về option đang chọn. Người dùng bấm ↓ ba lần, cha render một cái (một ô khác trong
 * cùng form đổi giá trị, một query trả về), và dòng sáng nhảy ngược. Bấm Enter thì chọn
 * nhầm — một thao tác bàn phím bình thường cho ra kết quả sai, im lặng.
 *
 * `Combobox` đã gặp đúng cơ chế này và vá ngày 10/09 (`combobox.tsx:129` — so bằng NỘI DUNG,
 * không bằng ô nhớ). `Select` bị sót. Đây đúng là mẫu N1 đã lặp bốn lần trong repo: vá một
 * cửa, quên cửa song song — và chính docblock ở đầu file này viết ra để chặn.
 *
 * ===== CÁCH VÁ, VÀ VÌ SAO KHÔNG COPY `JSON.stringify` CỦA COMBOBOX =====
 *
 * Combobox chỉ cần biết "danh sách có đổi không" nên băm khóa là đủ. Select cần một thứ hẹp
 * hơn và rẻ hơn: **chỉ mục của option đang chọn**. Đó là một SỐ — ổn định theo giá trị, nên
 * cha render lại mà nội dung không đổi thì nó không đổi, và effect không chạy. Danh sách đổi
 * thật (option đang chọn dời chỗ) thì số ấy đổi và dòng sáng đi theo, đúng như phải thế.
 */
describe('Select — cha render lại không được cướp dòng đang sáng', () => {
  const OPTIONS = [
    { value: 'a', label: 'Switch' },
    { value: 'b', label: 'Router' },
    { value: 'c', label: 'Firewall' },
  ];

  /*
   * CHA RENDER LẠI MÀ KHÔNG AI CHẠM CHUỘT — và đó là cả điểm mấu chốt của bài.
   *
   * Bản đầu của bài này dựng một cái nút "Cha render lại" rồi bấm vào. Nó đỏ, nhưng đỏ vì
   * một lý do KHÁC: bấm ra ngoài menu là một cú click ngoài, và `Select` đóng menu theo đúng
   * thiết kế. Bài đo nhầm thứ mình định đo, và nếu tin nó thì tôi đã đi "vá" một hành vi đang
   * đúng.
   *
   * Cảnh thật không có cú bấm nào: một query anh em trả về, một ô khác trong cùng form đổi
   * giá trị — cha render lại trong khi tay người dùng vẫn đang ở trên bàn phím. Nên bài này
   * gọi thẳng setState của cha.
   */
  let bumpParent: () => void = () => {};

  function Parent() {
    const [tick, setTick] = useState(0);
    bumpParent = () => setTick((n) => n + 1);
    return (
      <>
        <span data-testid="tick">{tick}</span>
        {/* `options` dựng MỚI mỗi lượt render — đúng như `lists.data?.x ?? []` ở màn thật. */}
        <Select
          value="a"
          onChange={() => {}}
          options={OPTIONS.map((o) => ({ ...o }))}
          ariaLabel="Loại thiết bị"
        />
      </>
    );
  }

  it('bấm ↓ hai lần rồi cha render lại: dòng sáng vẫn ở chỗ người dùng để nó', async () => {
    renderWithI18n(<Parent />);
    const trigger = screen.getByRole('button', { name: 'Loại thiết bị' });

    await userEvent.click(trigger);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');

    // "Firewall" — option thứ ba, cách hai bước từ "Switch" đang chọn.
    const highlighted = () =>
      document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent;
    expect(highlighted()).toBe('Firewall');

    act(() => bumpParent());
    expect(screen.getByTestId('tick')).toHaveTextContent('1');

    // Cha render lại KHÔNG phải một hành vi của người dùng — nó không được đổi gì.
    expect(highlighted()).toBe('Firewall');
  });

  it('mở menu lần đầu vẫn sáng đúng option đang chọn (vế đối chứng)', async () => {
    renderWithI18n(
      <Select value="b" onChange={() => {}} options={OPTIONS} ariaLabel="Loại thiết bị" />,
    );
    const trigger = screen.getByRole('button', { name: 'Loại thiết bị' });
    await userEvent.click(trigger);

    expect(
      document.getElementById(trigger.getAttribute('aria-activedescendant') ?? '')?.textContent,
    ).toBe('Router');
  });
});
