import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { YearQuickPicks } from '@/ui/year-quick-picks';

describe('YearQuickPicks — "+1/+2/+3 năm" từ một ngày mốc', () => {
  it('ba nút trong một nhóm có tên; bấm là đặt ngày = mốc + n năm', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithI18n(
      <YearQuickPicks base="2025-03-15" onPick={onPick} label="Đặt nhanh hạn bảo hành" />,
    );
    const group = screen.getByRole('group', { name: 'Đặt nhanh hạn bảo hành' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '+1 năm',
      '+2 năm',
      '+3 năm',
    ]);

    await user.click(screen.getByRole('button', { name: '+2 năm' }));
    expect(onPick).toHaveBeenLastCalledWith('2027-03-15');
    await user.click(screen.getByRole('button', { name: '+1 năm' }));
    expect(onPick).toHaveBeenLastCalledWith('2026-03-15');
  });

  it.each([
    [1, '2025-02-28'],
    [2, '2026-02-28'],
    [3, '2027-02-28'],
  ])('mốc 29/02/2024 +%i năm → %s (lùi về 28/02, không tràn sang tháng 3)', async (years, expected) => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithI18n(<YearQuickPicks base="2024-02-29" onPick={onPick} label="Đặt nhanh" />);
    await user.click(screen.getByRole('button', { name: `+${years} năm` }));
    expect(onPick).toHaveBeenCalledWith(expected);
  });

  it('chưa có mốc: mọi nút tắt, lý do nằm ở title, không gọi onPick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderWithI18n(
      <YearQuickPicks base="" onPick={onPick} label="Đặt nhanh" needBaseHint="Chọn ngày mua trước." />,
    );
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Chọn ngày mua trước.');
    }
    await user.click(screen.getByRole('button', { name: '+1 năm' }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('`years` đổi được bộ nút', () => {
    renderWithI18n(<YearQuickPicks base="2025-01-01" onPick={vi.fn()} label="Đặt nhanh" years={[1, 5]} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['+1 năm', '+5 năm']);
  });
});
