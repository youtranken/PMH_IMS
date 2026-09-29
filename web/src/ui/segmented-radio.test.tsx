import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { SegmentedRadio } from '@/ui/segmented-radio';

const OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'used', label: 'Đang dùng' },
  { value: 'free', label: 'Trống' },
];

function Harness({ initial = 'all', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedRadio
      label="Trạng thái"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

/*
 * Chọn MỘT trong nhiều (lọc theo trạng thái, kiểu xem, giao thức) là radiogroup theo ARIA:
 * trình đọc màn hình đọc "1 trên 3, đã chọn", và bàn phím đi bằng mũi tên trong nhóm, Tab
 * chỉ dừng MỘT lần ở lựa chọn đang bật thay vì đi qua từng nút.
 */
describe('SegmentedRadio', () => {
  it('là radiogroup có tên, mỗi lựa chọn là radio, đúng một cái được chọn', () => {
    renderWithI18n(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Trạng thái' });
    expect(group).toHaveClass('segmented');
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Tất cả', 'Đang dùng', 'Trống']);
    expect(screen.getByRole('radio', { name: 'Tất cả' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Trống' })).not.toBeChecked();
  });

  it('Tab chỉ dừng ở lựa chọn đang bật (roving tabindex)', () => {
    renderWithI18n(<Harness initial="used" />);
    expect(screen.getByRole('radio', { name: 'Đang dùng' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Tất cả' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'Trống' })).toHaveAttribute('tabindex', '-1');
  });

  it('chưa chọn gì: lựa chọn đầu nhận Tab để vào được nhóm', () => {
    renderWithI18n(<Harness initial="" />);
    expect(screen.getByRole('radio', { name: 'Tất cả' })).toHaveAttribute('tabindex', '0');
  });

  it('mũi tên phải/xuống chọn lựa chọn kế và dời tiêu điểm; cuối nhóm vòng về đầu', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Harness onChange={onChange} />);
    screen.getByRole('radio', { name: 'Tất cả' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Đang dùng' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Đang dùng' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Trống' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Tất cả' })).toBeChecked();
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['used', 'free', 'all']);
  });

  it('mũi tên trái/lên đi lùi; Home/End nhảy về hai đầu', async () => {
    renderWithI18n(<Harness />);
    screen.getByRole('radio', { name: 'Tất cả' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Trống' })).toBeChecked();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Đang dùng' })).toBeChecked();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('radio', { name: 'Tất cả' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('radio', { name: 'Trống' })).toBeChecked();
  });

  it('bấm chuột chọn; bấm lại cái đang chọn vẫn báo lên để nơi gọi tự quyết (bỏ lọc)', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Trống' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Trống' }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['free', 'free']);
  });

  it('lựa chọn bị khoá thì mũi tên bỏ qua nó', async () => {
    function Locked() {
      const [value, setValue] = useState('all');
      return (
        <SegmentedRadio
          label="Trạng thái"
          options={[OPTIONS[0], { ...OPTIONS[1], disabled: true }, OPTIONS[2]]}
          value={value}
          onChange={setValue}
        />
      );
    }
    renderWithI18n(<Locked />);
    screen.getByRole('radio', { name: 'Tất cả' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Trống' })).toBeChecked();
  });
});
