import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { DatePicker, parseTypedDate } from '@/ui/date-picker';

function Harness({ initial, onChange }: { initial: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <DatePicker
      value={value}
      ariaLabel="Ngày mua"
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

/** Ô ngày đang giữ tiêu điểm — đọc bằng số ngày hiển thị, không phụ thuộc định dạng locale. */
function focusedDay(): string | null {
  const el = document.activeElement as HTMLElement | null;
  return el?.closest('[role="dialog"]') ? (el.textContent ?? null) : null;
}

describe('DatePicker — bàn phím và trình đọc màn hình', () => {
  it('mở lịch: popover có TÊN, và tiêu điểm dời vào ngày đang chọn', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness initial="2026-09-15" />);
    await user.click(screen.getByRole('button', { name: 'Ngày mua' }));

    expect(screen.getByRole('dialog', { name: 'Ngày mua' })).toBeInTheDocument();
    expect(focusedDay()).toBe('15');
    expect(document.activeElement).toHaveAttribute('aria-pressed', 'true');
  });

  it('phím mũi tên đi trong lưới ngày; PageDown sang tháng sau; Enter chọn', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<Harness initial="2026-09-15" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Ngày mua' }));

    await user.keyboard('{ArrowRight}');
    expect(focusedDay()).toBe('16');
    await user.keyboard('{ArrowDown}');
    expect(focusedDay()).toBe('23');
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(focusedDay()).toBe('15');
    await user.keyboard('{PageDown}');
    expect(focusedDay()).toBe('15');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-15');
    // Chọn xong: lịch đóng, tiêu điểm về lại nút mở.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ngày mua' })).toHaveFocus();
  });

  it('chỉ MỘT ô ngày nằm trong luồng Tab; mỗi ô mang tên đủ ngày-tháng-năm', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness initial="2026-09-15" />);
    await user.click(screen.getByRole('button', { name: 'Ngày mua' }));
    const dialog = screen.getByRole('dialog', { name: 'Ngày mua' });
    const tabbable = dialog.querySelectorAll('[data-day][tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute('aria-label', expect.stringContaining('2026'));
  });

  it('ngày hôm nay mang aria-current="date"', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness initial="" />);
    await user.click(screen.getByRole('button', { name: 'Ngày mua' }));
    const today = screen
      .getByRole('dialog', { name: 'Ngày mua' })
      .querySelector('[aria-current="date"]');
    expect(today).not.toBeNull();
    expect(today?.textContent).toBe(String(new Date().getDate()));
    // Chưa chọn gì thì tiêu điểm vào ngày hôm nay.
    expect(document.activeElement).toBe(today);
  });
});

describe('parseTypedDate — gõ tay dd/mm/yyyy', () => {
  it.each([
    ['09/10/2026', '2026-10-09'],
    ['9/10/2026', '2026-10-09'],
    ['09-10-2026', '2026-10-09'],
    ['09.10.2026', '2026-10-09'],
    ['09102026', '2026-10-09'],
    [' 29/02/2028 ', '2028-02-29'],
    ['1/1/90', '1990-01-01'],
    ['1/1/25', '2025-01-01'],
  ])('"%s" → %s', (text, iso) => {
    expect(parseTypedDate(text)).toEqual({ value: iso, reason: null });
  });

  it.each([['31/02/2026'], ['29/02/2027'], ['32/01/2026'], ['12/13/2026'], ['abc'], ['2026-10-09x']])(
    '"%s" là ngày không có thật',
    (text) => {
      expect(parseTypedDate(text)).toEqual({ value: null, reason: 'invalid' });
    },
  );

  it('ô trống là "chưa gõ", không phải lỗi', () => {
    expect(parseTypedDate('   ')).toEqual({ value: null, reason: 'empty' });
  });
});

describe('DatePicker — gõ tay và tháng mở sẵn', () => {
  it('gõ một chữ số trên nút mở lịch là mở ô gõ ngày; Enter ghi ngày đã gõ', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<Harness initial="" onChange={onChange} />);
    screen.getByRole('button', { name: 'Ngày mua' }).focus();
    await user.keyboard('0');
    const typed = screen.getByRole('textbox', { name: 'Gõ ngày (dd/mm/yyyy)' });
    expect(typed).toHaveFocus();
    await user.keyboard('9/10/2026{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('2026-10-09');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gõ ngày không có thật thì báo ngay dưới ô, không ghi gì', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithI18n(<Harness initial="" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Ngày mua' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Gõ ngày (dd/mm/yyyy)' }),
      '31/02/2026{Enter}',
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Ngày không hợp lệ — gõ theo dạng dd/mm/yyyy.')).toBeInTheDocument();
  });

  it('`openTo` mở lịch ở đúng tháng khi ô còn trống (ngày sinh không mở ở tháng hiện tại)', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <DatePicker value="" ariaLabel="Ngày sinh" openTo="1990-01-01" onChange={() => undefined} />,
    );
    await user.click(screen.getByRole('button', { name: 'Ngày sinh' }));
    expect(screen.getByRole('group', { name: /1990/ })).toBeInTheDocument();
  });
});
