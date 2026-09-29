import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { Tabs, tabScrollLeft } from '@/ui/tabs';

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
   * nên thiếu dấu cách là trình đọc màn hình đọc "Giấy tờ0" thành một từ. Lỗi này không lộ
   * ra nếu không có bài kiểm nào đọc tên tab kèm số.
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
   * ===== SỐ 0 THÌ KHÔNG VẼ =====
   *
   * Có văn bản chứ không phải theo ý thích: `design-ims/v2-chi-tiet/_SPEC.md:61` xếp "Badge
   * đếm hiện số 0" vào danh sách LỖI, và `:529` đưa nó thành gạch nghiệm thu — "`count === 0`
   * thì KHÔNG vẽ `.tab-count`".
   *
   * Lý do: số 0 không nói thêm gì so với việc mở tab ra và thấy khu rỗng, nhưng nó làm hàng
   * tab của một hồ sơ mới trông như đang hỏng — đo trên trình duyệt thật thì một thiết bị
   * trống cho ra "Tổng quan · Giấy tờ 0 · Két sắt 0 · Lịch sử".
   *
   * Bài trên (dấu cách giữa nhãn và số, để trình đọc màn hình không đọc "Giấy tờ0" thành một
   * từ) vì thế dùng số mẫu khác 0.
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

describe('tabScrollLeft — đưa tab đang chọn vào giữa khung, chỉ theo chiều ngang', () => {
  it.each([
    // khung 300px, nội dung 900px; tab 100px đứng ở x=600 (tính trong nội dung) → cuộn 500
    [{ scrollLeft: 0, barWidth: 300, scrollWidth: 900, tabOffset: 600, tabWidth: 100 }, 500],
    // tab đầu: không cuộn âm
    [{ scrollLeft: 200, barWidth: 300, scrollWidth: 900, tabOffset: 0, tabWidth: 100 }, 0],
    // tab cuối: kẹp ở mép phải, không cuộn quá nội dung
    [{ scrollLeft: 0, barWidth: 300, scrollWidth: 900, tabOffset: 850, tabWidth: 50 }, 600],
    // mọi tab vừa khung: đứng yên
    [{ scrollLeft: 0, barWidth: 900, scrollWidth: 900, tabOffset: 600, tabWidth: 100 }, 0],
  ])('%o → %i', (input, expected) => {
    expect(tabScrollLeft(input)).toBe(expected);
  });
});

describe('Tabs trên màn hẹp — tab đang chọn luôn nằm trong khung', () => {
  const original = {
    scrollTo: (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo,
    scrollIntoView: HTMLElement.prototype.scrollIntoView,
  };
  afterEach(() => {
    (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo = original.scrollTo;
    HTMLElement.prototype.scrollIntoView = original.scrollIntoView;
  });

  /** Giả lập khung tab 300px chứa 7 tab mỗi tab 100px (jsdom không có bố cục). */
  function layout(bar: HTMLElement) {
    Object.defineProperty(bar, 'clientWidth', { configurable: true, value: 300 });
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: 700 });
    bar.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    bar.querySelectorAll<HTMLElement>('[role="tab"]').forEach((tab, i) => {
      tab.getBoundingClientRect = () =>
        ({ left: i * 100 - bar.scrollLeft, width: 100 }) as DOMRect;
    });
  }

  const SEVEN = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key) => ({ key, label: key.toUpperCase() }));

  it('đổi tab thì khung tab tự cuộn NGANG tới tab mới, không kéo cả trang', async () => {
    const scrollTo = vi.fn();
    const scrollIntoView = vi.fn();
    (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo = scrollTo;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    function H() {
      const [v, setV] = useState('a');
      return <Tabs items={SEVEN} value={v} onChange={setV} ariaLabel="Danh mục" />;
    }
    renderWithI18n(<H />);
    const bar = screen.getByRole('tablist');
    layout(bar);

    await userEvent.setup().click(screen.getByRole('tab', { name: 'F' }));

    // tab F ở x=500, rộng 100, khung 300 → giữa khung = 500 + 50 - 150 = 400
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 400 }));
    expect(scrollTo.mock.contexts.at(-1)).toBe(bar);
    // scrollIntoView cuộn MỌI tổ tiên, kể cả trang — khi thanh tab ở y≈590 trên điện thoại,
    // vừa mở trang đã bị kéo xuống giữa chừng.
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('mở trang với ?tab= ở tab cuối thì khung đã cuộn sẵn tới đó', () => {
    const scrollTo = vi.fn();
    (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo = scrollTo;
    // Bố cục phải có TRƯỚC lượt effect đầu, nên cài lên prototype rồi mới render.
    const rect = HTMLElement.prototype.getBoundingClientRect;
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const sw = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.getAttribute('role') === 'tablist') return { left: 0, width: 300 } as DOMRect;
      const i = SEVEN.findIndex((t) => this.id === `tab-${t.key}`);
      return { left: i * 100, width: 100 } as DOMRect;
    };
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, get: () => 700 });
    try {
      renderWithI18n(<Tabs items={SEVEN} value="g" onChange={() => {}} ariaLabel="Danh mục" />);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 400 }));
    } finally {
      HTMLElement.prototype.getBoundingClientRect = rect;
      if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
      if (sw) Object.defineProperty(Element.prototype, 'scrollWidth', sw);
    }
  });

  it('còn tab khuất ở mép nào thì khung đánh dấu mép đó (để CSS làm mờ)', () => {
    renderWithI18n(<Tabs items={SEVEN} value="a" onChange={() => {}} ariaLabel="Danh mục" />);
    const bar = screen.getByRole('tablist');
    expect(bar).not.toHaveAttribute('data-more-end');

    layout(bar);
    fireEvent.scroll(bar);
    expect(bar).toHaveAttribute('data-more-end', 'true');
    expect(bar).not.toHaveAttribute('data-more-start');

    Object.defineProperty(bar, 'scrollLeft', { configurable: true, value: 400 });
    fireEvent.scroll(bar);
    expect(bar).toHaveAttribute('data-more-start', 'true');
    expect(bar).not.toHaveAttribute('data-more-end');
  });
});
