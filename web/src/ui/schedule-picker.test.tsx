import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { SchedulePicker, describeSchedule, type ScheduleValue } from '@/ui/schedule-picker';

describe('describeSchedule — câu mô tả lịch đọc từ vi.ts', () => {
  it.each<[string, ScheduleValue, string]>([
    ['hằng ngày', { frequency: 'daily', hour: 7 }, 'Hằng ngày lúc 07:00'],
    ['hằng tuần, thứ Hai', { frequency: 'weekly', hour: 8, weekday: 1 }, 'Hằng tuần, Thứ Hai lúc 08:00'],
    ['hằng tuần, Chủ Nhật', { frequency: 'weekly', hour: 20, weekday: 7 }, 'Hằng tuần, Chủ Nhật lúc 20:00'],
    ['hằng tuần, thiếu thứ → thứ Hai', { frequency: 'weekly', hour: 9 }, 'Hằng tuần, Thứ Hai lúc 09:00'],
    ['hằng tháng', { frequency: 'monthly', hour: 6, dayOfMonth: 15 }, 'Hằng tháng, ngày 15 lúc 06:00'],
  ])('%s', (_ten, value, expected) => {
    expect(describeSchedule(value)).toBe(expected);
  });
});

describe('SchedulePicker — nhãn ô chọn qua i18n', () => {
  it('lịch hằng tuần có đủ nhãn và bảy thứ', () => {
    renderWithI18n(
      <SchedulePicker value={{ frequency: 'weekly', hour: 8, weekday: 3 }} onChange={() => {}} />,
    );
    expect(screen.getByLabelText('Tần suất')).toBeInTheDocument();
    expect(screen.getByLabelText('Lúc')).toBeInTheDocument();
    const weekday = screen.getByLabelText('Vào thứ');
    expect(weekday).toHaveDisplayValue('Thứ Tư');
    expect(weekday.querySelectorAll('option')).toHaveLength(7);
  });
});
