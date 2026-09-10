import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '@/ui/dialog';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * `dismissible={false}` PHẢI BỊT ĐỦ BA CỬA, KHÔNG PHẢI HAI.
 *
 * ===== LỖ =====
 *
 * Prop này ra đời để chặn đúng một cảnh: lượt ghi ĐANG BAY, hộp biến mất, POST vẫn hoàn tất —
 * dữ liệu đã vào sổ nhưng `onSaved()` không chạy, nên không toast, không refresh, và người
 * vận hành tin là mình đã hủy. Nó bịt Esc (`onEscapeKeyDown`), bịt click-nền
 * (`onPointerDownOutside`/`onInteractOutside`), bịt nút ✕ (`disabled={!dismissible}`).
 *
 * Cửa thứ tư thì để mở: NÚT HỦY ở chân hộp. Nó là `children` do nơi gọi truyền vào, nên
 * `Dialog` không chạm tới được — và kiểm lại 18 hộp trong repo thì đúng 1 (`import-dialog`)
 * nhớ tự `disabled={busy}`, 17 hộp còn lại thì không. Người dùng bấm Hủy trong lúc chờ và
 * rơi vào ĐÚNG cái cảnh mà prop này sinh ra để chặn — chỉ khác đường vào.
 *
 * ===== VÌ SAO CHẶN Ở ĐÂY, KHÔNG PHẢI Ở 18 NƠI GỌI =====
 *
 * "Đang bận thì chân hộp không ăn" là MỘT khái niệm. Bắt 18 nơi gọi cùng nhớ một khái niệm là
 * đúng cách 17/18 đã quên nó (AD-15). Nơi gọi vẫn nên `disabled` nút Hủy cho người dùng THẤY
 * nó mờ đi; hàng rào ở đây là thứ chặn HẬU QUẢ kể cả khi ai đó quên.
 */
describe('Dialog — chân hộp không được ăn click khi đang bận', () => {
  const setup = (dismissible: boolean) => {
    const onCancel = vi.fn();
    renderWithI18n(
      <Dialog
        open
        onOpenChange={vi.fn()}
        dismissible={dismissible}
        title="Sửa thiết bị"
        footer={
          <>
            <button type="button" onClick={onCancel}>
              Hủy
            </button>
            <button type="submit" disabled={!dismissible}>
              Lưu
            </button>
          </>
        }
      >
        <p>thân hộp</p>
      </Dialog>,
    );
    return { onCancel };
  };

  it('đang bận: bấm Hủy KHÔNG đóng hộp — lượt ghi vẫn đang bay', async () => {
    const { onCancel } = setup(false);
    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  /** Vế đối chứng: bình thường thì nút Hủy phải ăn như cũ — 17 hộp kia đang dựa vào nó. */
  it('bình thường: nút Hủy chạy đúng như cũ', async () => {
    const { onCancel } = setup(true);
    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
