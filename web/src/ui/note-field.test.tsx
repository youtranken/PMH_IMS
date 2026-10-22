import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { NoteField } from './note-field';

/* FM-18: mọi ô Ghi chú một kiểu — ô nhiều dòng, một câu cảnh báo mật khẩu, lỗi dưới ô. */
describe('NoteField', () => {
  it('ô nhiều dòng 2 hàng, nhãn mặc định "Ghi chú", câu cảnh báo chung', () => {
    renderWithI18n(<NoteField id="n" value="" onChange={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Ghi chú' });
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '2');
    expect(box).toHaveAccessibleDescription('Không ghi mật khẩu — cất vào Két sắt.');
  });

  it('gõ chữ → onChange nhận chuỗi; lỗi hiện dưới ô', async () => {
    const onChange = vi.fn();
    renderWithI18n(<NoteField id="n" label="Ghi chú ghế" value="" onChange={onChange} error="Có vẻ là mật khẩu." />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Ghi chú ghế' }), 'a');
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.getByRole('textbox', { name: 'Ghi chú ghế' })).toHaveAccessibleDescription(/Có vẻ là mật khẩu\./);
  });
});
