import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { Tabs } from '@/ui/tabs';

const ITEMS = [
  { key: 'site', label: 'Site' },
  { key: 'cabinet', label: 'Tủ mạng' },
  { key: 'vendor', label: 'Nhà cung cấp' },
];

function Harness() {
  const [value, setValue] = useState('site');
  return <Tabs items={ITEMS} value={value} onChange={setValue} ariaLabel="Danh mục" />;
}

describe('Tabs dùng chung', () => {
  it('chỉ tab đang chọn nằm trong luồng Tab của bàn phím', () => {
    renderWithI18n(<Harness />);
    expect(screen.getByRole('tab', { name: 'Site' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Tủ mạng' })).toHaveAttribute('tabindex', '-1');
  });

  it('phím mũi tên chuyển tab và cuộn vòng ở hai đầu', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness />);
    const site = screen.getByRole('tab', { name: 'Site' });
    site.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Tủ mạng' })).toHaveAttribute('aria-selected', 'true');

    // Từ tab đầu bấm ← phải sang tab cuối, không phải kẹt lại.
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Nhà cung cấp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Home/End nhảy về tab đầu và tab cuối', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness />);
    screen.getByRole('tab', { name: 'Site' }).focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Nhà cung cấp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Site' })).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * Con số trên nhãn phải TÁCH khỏi chữ trong tên khả truy cập.
   *
   * Khoảng cách bằng CSS chỉ có nghĩa với mắt: tên khả truy cập ghép thẳng hai node văn bản,
   * nên thiếu dấu cách là trình đọc màn hình đọc "Giấy tờ0" thành một từ. Lỗi này sống từ Epic
   * 3 (tab "Máy đang dùng" đã có `count`) tới 28/08/2026 mới lộ, vì tới lúc đó mới có bài kiểm
   * nào đọc tên tab kèm số.
   */
  it('số trên nhãn tách khỏi chữ', () => {
    renderWithI18n(
      <Tabs
        items={[
          { key: 'files', label: 'Giấy tờ', count: 3 },
          { key: 'vault', label: 'Két sắt', count: 12 },
          { key: 'history', label: 'Lịch sử' },
        ]}
        value="files"
        onChange={() => {}}
        ariaLabel="Thiết bị"
      />,
    );

    expect(screen.getByRole('tab', { name: 'Giấy tờ 3' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Két sắt 12' })).toBeInTheDocument();
    // Không truyền `count` thì không có số nào bám vào nhãn.
    expect(screen.getByRole('tab', { name: 'Lịch sử' })).toBeInTheDocument();
  });

  /*
   * ===== QUYẾT ĐỊNH VỀ SỐ 0 ĐÃ ĐẢO (18/09/2026) =====
   *
   * Bản 28/08 của bài trên khẳng định ngược lại: "0 là câu trả lời THẬT (chưa đính giấy tờ
   * nào) và vẫn phải hiện". Đợt thiết kế v2 đảo lại, và đảo có văn bản chứ không phải theo ý
   * thích: `design-ims/v2-chi-tiet/_SPEC.md:61` xếp "Badge đếm hiện số 0" vào danh sách LỖI
   * của bản cũ, và `:529` đưa nó thành gạch nghiệm thu — "`count === 0` thì KHÔNG vẽ
   * `.tab-count`".
   *
   * Lý do: số 0 không nói thêm gì so với việc mở tab ra và thấy khu rỗng, nhưng nó làm hàng
   * tab của một hồ sơ mới trông như đang hỏng — đo trên trình duyệt thật thì một thiết bị
   * trống cho ra "Tổng quan · Giấy tờ 0 · Két sắt 0 · Lịch sử".
   *
   * Ý định gốc của bài trên (dấu cách giữa nhãn và số, để trình đọc màn hình không đọc
   * "Giấy tờ0" thành một từ) vẫn còn nguyên giá trị — nên nó được giữ, chỉ đổi số mẫu.
   */
  it('count = 0 thì không vẽ số nào cả', () => {
    renderWithI18n(
      <Tabs
        items={[
          { key: 'files', label: 'Giấy tờ', count: 0 },
          { key: 'history', label: 'Lịch sử' },
        ]}
        value="files"
        onChange={() => {}}
        ariaLabel="Thiết bị"
      />,
    );

    expect(screen.getByRole('tab', { name: 'Giấy tờ' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Giấy tờ 0' })).toBeNull();
  });

  it('bấm chuột cũng đổi tab', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'Nhà cung cấp' }));
    expect(screen.getByRole('tab', { name: 'Nhà cung cấp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
