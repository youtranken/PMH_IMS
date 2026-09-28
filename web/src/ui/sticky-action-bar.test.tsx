import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, within } from '@/test/test-utils';
import { StickyActionBar } from '@/ui/sticky-action-bar';

describe('StickyActionBar', () => {
  it('là một nhóm có tên, có dòng ngữ cảnh và đúng các nút truyền vào', () => {
    renderWithI18n(
      <StickyActionBar label="Quyết định" note="Cần người khác duyệt">
        <button type="button" className="btn">
          Từ chối
        </button>
        <button type="button" className="btn primary">
          Duyệt
        </button>
      </StickyActionBar>,
    );
    const bar = screen.getByRole('group', { name: 'Quyết định' });
    expect(bar).toHaveClass('sticky-action-bar');
    expect(within(bar).getByText('Cần người khác duyệt')).toBeInTheDocument();
    const buttons = within(bar).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Từ chối', 'Duyệt']);
    // CSS bám `.sticky-action-buttons > .btn`: bọc thêm một lớp là mất kiểu 48px.
    buttons.forEach((b) => expect(b.parentElement).toHaveClass('sticky-action-buttons'));
  });

  it('không có nút thì không vẽ hàng nút rỗng', () => {
    renderWithI18n(<StickyActionBar label="Quyết định" note="Đã xử lý" />);
    expect(screen.getByRole('group', { name: 'Quyết định' }).querySelector('.sticky-action-buttons')).toBeNull();
  });
});
