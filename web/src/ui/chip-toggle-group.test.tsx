import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithI18n, screen } from '@/test/test-utils';
import { ChipToggleGroup, toggleChip } from '@/ui/chip-toggle-group';

const OPTIONS = [
  { value: 'ssl', label: 'Chứng chỉ SSL' },
  { value: 'domain', label: 'Tên miền' },
  { value: 'license', label: 'License' },
];

describe('toggleChip', () => {
  it.each([
    { value: [], key: 'ssl', out: ['ssl'] },
    { value: ['ssl'], key: 'domain', out: ['ssl', 'domain'] },
    { value: ['ssl', 'domain'], key: 'ssl', out: ['domain'] },
    // Giữ thứ tự của danh sách lựa chọn, không theo thứ tự bấm: URL `?kinds=` ổn định.
    { value: ['domain'], key: 'ssl', out: ['ssl', 'domain'] },
  ])('$value + $key → $out', ({ value, key, out }) => {
    expect(toggleChip(value, key, OPTIONS.map((o) => o.value))).toEqual(out);
  });
});

describe('ChipToggleGroup', () => {
  it('chưa chọn gì thì nút "Tất cả" đang bật; bấm hai loại thì chọn cả hai', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithI18n(
      <ChipToggleGroup label="Loại" allLabel="Tất cả" options={OPTIONS} value={[]} onChange={onChange} />,
    );
    const group = screen.getByRole('group', { name: 'Loại' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Chứng chỉ SSL' }));
    expect(onChange).toHaveBeenLastCalledWith(['ssl']);

    rerender(
      <ChipToggleGroup label="Loại" allLabel="Tất cả" options={OPTIONS} value={['ssl']} onChange={onChange} />,
    );
    expect(screen.getByRole('button', { name: 'Tất cả' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Chứng chỉ SSL' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Tên miền' }));
    expect(onChange).toHaveBeenLastCalledWith(['ssl', 'domain']);
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
