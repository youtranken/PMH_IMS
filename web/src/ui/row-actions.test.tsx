import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { RowActions } from '@/ui/row-actions';

function items(onEdit = vi.fn(), onDelete = vi.fn()) {
  return [
    { key: 'edit', label: 'Sửa', onSelect: onEdit },
    { key: 'delete', label: 'Xóa', onSelect: onDelete, danger: true },
    { key: 'assign', label: 'Gán vào máy', onSelect: vi.fn() },
  ];
}

describe('RowActions — menu ba chấm dùng chung', () => {
  it('menu đóng thì KHÔNG mục nào nằm trong DOM', () => {
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items()} />);
    expect(screen.getByRole('button', { name: 'Thao tác với LIC-01' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Sửa' })).not.toBeInTheDocument();
  });

  /**
   * Tên nút PHẢI kèm mã hồ sơ. Dùng chung một chữ "Thao tác" thì hai chục dòng mang cùng một
   * cái tên: trình đọc màn hình đọc y hệt nhau, và `getByRole` của bài kiểm khớp cả hai chục.
   */
  it('nút mang tên riêng theo dòng, không phải "Thao tác" trơ', () => {
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items()} />);
    expect(screen.getByRole('button', { name: 'Thao tác với LIC-01' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
  });

  it('bấm mở menu, chọn một mục thì gọi đúng hàm và menu đóng lại', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items(onEdit)} />);

    await user.click(screen.getByRole('button', { name: 'Thao tác với LIC-01' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sửa' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: 'Sửa' })).not.toBeInTheDocument();
  });

  /**
   * "Xóa" nằm ngay dưới con trỏ lúc menu vừa bung ra là chỗ ngón tay rơi vào khi bấm nhanh
   * hai lần. Thứ tự này còn phải GIỐNG NHAU ở mọi bảng thì trí nhớ cơ bắp mới dùng lại được.
   */
  it('việc nguy hiểm luôn xuống cuối, dù khai ở giữa danh sách', async () => {
    const user = userEvent.setup();
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items()} />);
    await user.click(screen.getByRole('button', { name: 'Thao tác với LIC-01' }));

    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
    expect(labels).toEqual(['Sửa', 'Gán vào máy', 'Xóa']);
  });

  it('mở ra là focus rơi vào mục đầu, ↓ đi tiếp, không nhảy ngược về đầu', async () => {
    const user = userEvent.setup();
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items()} />);
    await user.click(screen.getByRole('button', { name: 'Thao tác với LIC-01' }));

    expect(screen.getByRole('menuitem', { name: 'Sửa' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Gán vào máy' })).toHaveFocus();
    // ↓ lần hai phải sang mục thứ BA. Bản đầu đưa mảng mục vào deps của effect focus, nên
    // effect chạy lại sau mỗi render và kéo focus về mục đầu — phím ↓ trông như chết.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Xóa' })).toHaveFocus();
  });

  it('↓ ở mục cuối cuộn vòng về đầu, ↑ ở mục đầu cuộn về cuối', async () => {
    const user = userEvent.setup();
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items()} />);
    await user.click(screen.getByRole('button', { name: 'Thao tác với LIC-01' }));

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Xóa' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Sửa' })).toHaveFocus();
  });

  it('Home/End nhảy về mục đầu và mục cuối', async () => {
    const user = userEvent.setup();
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items()} />);
    await user.click(screen.getByRole('button', { name: 'Thao tác với LIC-01' }));

    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Xóa' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'Sửa' })).toHaveFocus();
  });

  /** Esc mà không trả focus về nút là bỏ người dùng bàn phím giữa trang, không biết đang ở đâu. */
  it('Esc đóng menu và TRẢ focus về nút ba chấm', async () => {
    const user = userEvent.setup();
    renderWithI18n(<RowActions label="Thao tác với LIC-01" items={items()} />);
    const trigger = screen.getByRole('button', { name: 'Thao tác với LIC-01' });

    await user.click(trigger);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menuitem', { name: 'Sửa' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('mục bị khóa thì không nhận focus khi vừa mở', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <RowActions
        label="Thao tác với LIC-01"
        items={[
          { key: 'busy', label: 'Đang chạy', onSelect: vi.fn(), disabled: true },
          { key: 'edit', label: 'Sửa', onSelect: vi.fn() },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Thao tác với LIC-01' }));
    expect(screen.getByRole('menuitem', { name: 'Sửa' })).toHaveFocus();
  });

  /** Ba chấm bấm ra một menu rỗng là một lời hứa hão — thà không vẽ nút nào. */
  it('không có việc nào làm được thì không vẽ nút', () => {
    const { container } = renderWithI18n(<RowActions label="Thao tác với LIC-01" items={[]} />);
    expect(container.querySelector('.row-actions')).toBeNull();
  });
});
