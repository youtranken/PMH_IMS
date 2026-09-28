import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import '@/lib/i18n';
import { activeOptions } from '@/ui/use-catalog-lists';

/**
 * Q-14: mục danh mục đã vô hiệu KHÔNG chọn mới được, nhưng hồ sơ đang trỏ vào nó vẫn phải
 * đọc được đúng tên — ô chọn thiếu mục đó sẽ hiện trống, như thể hồ sơ chưa từng có giá trị.
 */
const rows = [
  { id: 'a', name: 'Switch', active: true },
  { id: 'b', name: 'Máy in cũ', active: false },
  { id: 'c', name: 'Router', active: true },
];
const label = (row: (typeof rows)[number]) => row.name;

function text(node: unknown): string {
  const { container } = render(<>{node}</>);
  return container.textContent ?? '';
}

describe('activeOptions', () => {
  it('thêm mới: chỉ mục còn dùng', () => {
    expect(activeOptions(rows, '', label).map((o) => o.value)).toEqual(['a', 'c']);
    expect(activeOptions(rows, null, label).map((o) => o.value)).toEqual(['a', 'c']);
  });

  it('hồ sơ đang trỏ vào mục đã vô hiệu: giữ mục đó, nhãn "(ngừng dùng)"', () => {
    const options = activeOptions(rows, 'b', label);
    expect(options.map((o) => o.value)).toEqual(['a', 'b', 'c']);
    expect(text(options[1].label)).toBe('Máy in cũ (ngừng dùng)');
    expect(text(options[0].label)).toBe('Switch');
  });

  it('danh sách chưa tải xong thì rỗng, không ném', () => {
    expect(activeOptions(undefined, 'b', label)).toEqual([]);
  });
});
