import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/ui/dialog';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * LF-01: hộp con (Thêm model) mở từ TRONG form thiết bị. Hộp nằm ở portal nên DOM tách rời, nhưng
 * sự kiện React nổi bọt theo cây component: Lưu ở hộp con nộp luôn form thiết bị bên dưới.
 */
describe('Dialog — submit không lan ra form cha', () => {
  it('nộp form trong hộp không gọi onSubmit của form bọc ngoài', async () => {
    const outer = vi.fn((e: React.FormEvent) => e.preventDefault());
    const inner = vi.fn((e: React.FormEvent) => e.preventDefault());
    renderWithI18n(
      <form onSubmit={outer}>
        <Dialog open onOpenChange={vi.fn()} title="Thêm model">
          <form onSubmit={inner}>
            <button type="submit">Lưu model</button>
          </form>
        </Dialog>
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Lưu model' }));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});

/** LF-28: Esc trong ô gợi ý (combobox) đã gõ chữ mà không có gợi ý nào thì đóng luôn cả hộp. */
describe('Dialog — Esc trong combobox đã có chữ không đóng hộp', () => {
  it('combobox có chữ: Esc giữ hộp', async () => {
    const onOpenChange = vi.fn();
    renderWithI18n(
      <Dialog open onOpenChange={onOpenChange} title="Thêm thiết bị">
        <input role="combobox" aria-expanded="false" aria-label="Model" defaultValue="C93" />
      </Dialog>,
    );
    screen.getByRole('combobox', { name: 'Model' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('combobox trống: Esc vẫn đóng hộp như thường', async () => {
    const onOpenChange = vi.fn();
    renderWithI18n(
      <Dialog open onOpenChange={onOpenChange} title="Thêm thiết bị">
        <input role="combobox" aria-expanded="false" aria-label="Model" defaultValue="" />
      </Dialog>,
    );
    screen.getByRole('combobox', { name: 'Model' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
