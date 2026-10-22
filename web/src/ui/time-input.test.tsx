import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { maskTimeTyping, TimeInput } from '@/ui/time-input';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/** FM-15 / DS-28: ô giờ native hiện "--:-- --" (12 giờ AM/PM), cao lệch, khác kiểu DatePicker. */
describe('maskTimeTyping', () => {
  it.each([
    ['', '0', '0'],
    ['0', '02', '02:'],
    ['02:', '02::', '02:'],
    ['02:', '02:1', '02:1'],
    ['02:1', '02:10', '02:10'],
    ['02:', '02', '02'],
    ['', '2:', '2:'],
  ])('%s → %s → %s', (prev, next, out) => {
    expect(maskTimeTyping(prev, next)).toBe(out);
  });
});

describe('TimeInput', () => {
  function Harness() {
    const [v, setV] = useState('');
    return <TimeInput aria-label="Giờ phát hiện" value={v} onChange={setV} />;
  }
  it('ô chữ 24 giờ: gõ 0210 ra 02:10, bàn phím số', async () => {
    renderWithI18n(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Giờ phát hiện' });
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('placeholder', 'hh:mm');
    await userEvent.type(input, '0210');
    expect(input).toHaveValue('02:10');
  });
});
