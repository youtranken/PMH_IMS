import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { DatePicker } from '@/ui/date-picker';

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
