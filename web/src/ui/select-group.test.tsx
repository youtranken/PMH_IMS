import { describe, expect, it, vi } from 'vitest';
import { within } from '@testing-library/react';
import { Select } from '@/ui/select';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * Nhóm lựa chọn: tủ của hai site trùng hậu tố mã thì chỉ đọc được khi menu chia theo site —
 * mục chỉ còn mã tủ, tiêu đề nhóm nói site. Tiêu đề không phải lựa chọn: ↑/↓ không dừng ở đó.
 */
describe('Select — option.group', () => {
  const options = [
    { value: '', label: 'Tất cả tủ' },
    { value: 'a', label: 'TU-01', short: 'HCM · TU-01', group: 'HCM' },
    { value: 'b', label: 'TU-02', short: 'HCM · TU-02', group: 'HCM' },
    { value: 'c', label: 'TU-01', short: 'HN · TU-01', group: 'HN' },
  ];

  it('vẽ tiêu đề nhóm một lần mỗi nhóm, nằm trong role=group có tên', async () => {
    renderWithI18n(<Select value="" onChange={vi.fn()} options={options} ariaLabel="Tủ" />);
    await userEvent.click(screen.getByRole('button', { name: 'Tủ' }));
    const hcm = screen.getByRole('group', { name: 'HCM' });
    expect(within(hcm).getAllByRole('option')).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: 'HN' })).getAllByRole('option')).toHaveLength(1);
    expect(screen.getAllByRole('option')).toHaveLength(4);
  });

  it('↓ đi qua tiêu đề nhóm, Enter chọn đúng mục của nhóm sau', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Select value="b" onChange={onChange} options={options} ariaLabel="Tủ" />);
    await userEvent.click(screen.getByRole('button', { name: 'Tủ' }));
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('nút đã chọn hiện `short` kèm site', () => {
    renderWithI18n(<Select value="c" onChange={vi.fn()} options={options} ariaLabel="Tủ" />);
    expect(screen.getByRole('button', { name: 'Tủ' })).toHaveTextContent('HN · TU-01');
  });
});
