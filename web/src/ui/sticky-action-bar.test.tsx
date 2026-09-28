import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, within } from '@/test/test-utils';
import { StickyActionBar } from '@/ui/sticky-action-bar';

describe('StickyActionBar', () => {
  it('là một nhóm có tên, chứa đúng các nút truyền vào (nút là con trực tiếp)', () => {
    renderWithI18n(
      <StickyActionBar ariaLabel="Thao tác với yêu cầu">
        <button type="button">Từ chối</button>
        <button type="button" className="primary">
          Duyệt
        </button>
      </StickyActionBar>,
    );
    const bar = screen.getByRole('group', { name: 'Thao tác với yêu cầu' });
    expect(bar).toHaveClass('sticky-action-bar');
    const buttons = within(bar).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Từ chối', 'Duyệt']);
    // CSS mobile bám `> button`: bọc thêm một lớp là mất kiểu 48px / full width.
    buttons.forEach((b) => expect(b.parentElement).toBe(bar));
  });
});
