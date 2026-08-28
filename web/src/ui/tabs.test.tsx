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
  it('số trên nhãn tách khỏi chữ, kể cả khi số là 0', () => {
    renderWithI18n(
      <Tabs
        items={[
          { key: 'files', label: 'Giấy tờ', count: 0 },
          { key: 'vault', label: 'Két sắt', count: 12 },
          { key: 'history', label: 'Lịch sử' },
        ]}
        value="files"
        onChange={() => {}}
        ariaLabel="Thiết bị"
      />,
    );

    // 0 là câu trả lời THẬT ("chưa đính giấy tờ nào") và vẫn phải hiện.
    expect(screen.getByRole('tab', { name: 'Giấy tờ 0' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Két sắt 12' })).toBeInTheDocument();
    // Không truyền `count` thì không có số nào bám vào nhãn.
    expect(screen.getByRole('tab', { name: 'Lịch sử' })).toBeInTheDocument();
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
