import { describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
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

/**
 * `guardUnsaved` — Esc / bấm nền / ✕ chỉ vứt dữ liệu khi người dùng NÓI là được vứt.
 *
 * ===== LỖ =====
 *
 * `dismissible={!save.isPending}` chỉ chặn lúc lượt ghi đang bay. TRƯỚC khi bấm Lưu thì Esc
 * đóng thẳng và xoá sạch — 10 form trong repo như vậy, nặng nhất là `device-form` (15 ô).
 * Không một chữ hỏi lại, và không có Ctrl+Z cho một cái hộp đã tháo khỏi cây React.
 *
 * ===== HAI VẾ PHẢI ĐI ĐÔI =====
 *
 * Bài "có gõ thì hỏi" một mình là chưa đủ. Một bản vá lười — hỏi lại ở MỌI lần đóng — cũng
 * làm nó xanh, mà đó là bản tệ hơn hiện trạng: mở nhầm hộp rồi Esc là việc xảy ra suốt ngày,
 * và một câu hỏi thừa mỗi lần sẽ dạy người dùng bấm "Bỏ và đóng" theo phản xạ — tới hôm có
 * dữ liệu thật thì họ cũng bấm nó, không đọc. Nên vế thứ hai ("không gõ gì thì đóng thẳng")
 * mới là vế giữ cho cửa này còn có nghĩa.
 */
describe('Dialog — guardUnsaved: không vứt dữ liệu đang gõ dở', () => {
  const setup = () => {
    const onOpenChange = vi.fn();
    renderWithI18n(
      <ConfirmProvider>
        <Dialog open onOpenChange={onOpenChange} guardUnsaved title="Thêm thiết bị">
          <input aria-label="Mã máy" defaultValue="" />
        </Dialog>
      </ConfirmProvider>,
    );
    return { onOpenChange };
  };

  it('chưa gõ gì: Esc đóng thẳng, KHÔNG hỏi thừa một câu', async () => {
    const { onOpenChange } = setup();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByText('Bỏ những gì vừa nhập?'),
      'hộp trắng trơn mà vẫn hỏi thì người dùng sẽ học cách bấm "Bỏ" không đọc',
    ).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('đã gõ: Esc hỏi lại, và chưa đóng gì cả', async () => {
    const { onOpenChange } = setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Mã máy' }), 'PC-01');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Bỏ những gì vừa nhập?')).toBeInTheDocument();
    expect(onOpenChange, 'hỏi xong mới được đóng — hỏi rồi đóng luôn là hỏi cho có').not.toHaveBeenCalled();
  });

  it('đã gõ rồi chọn "Ở lại nhập tiếp": hộp vẫn mở, chữ vẫn còn', async () => {
    const { onOpenChange } = setup();
    const o = screen.getByRole('textbox', { name: 'Mã máy' });
    await userEvent.type(o, 'PC-01');
    await userEvent.keyboard('{Escape}');
    // `ConfirmDialog` dùng `cancelLabel` cho CẢ nút ✕ lẫn nút chân hộp, nên tên này trúng
    // hai nút. Lấy cái CUỐI — chân hộp nằm sau phần đầu hộp trong tài liệu.
    const triggerButton = await screen.findAllByRole('button', { name: 'Ở lại nhập tiếp' });
    await userEvent.click(triggerButton[triggerButton.length - 1]);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(o).toHaveValue('PC-01');
  });

  it('đã gõ rồi chọn "Bỏ và đóng": lúc đó mới đóng', async () => {
    const { onOpenChange } = setup();
    await userEvent.type(screen.getByRole('textbox', { name: 'Mã máy' }), 'PC-01');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Bỏ và đóng' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  /*
   * Gõ rồi xoá về đúng chỗ cũ thì KHÔNG còn gì để mất — hỏi ở đây là báo động giả, và báo
   * động giả là thứ bào mòn lòng tin vào cửa canh nhanh nhất.
   */
  it('gõ rồi xoá sạch về như cũ: đóng thẳng', async () => {
    const { onOpenChange } = setup();
    const o = screen.getByRole('textbox', { name: 'Mã máy' });
    await userEvent.type(o, 'PC-01');
    await userEvent.clear(o);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Bỏ những gì vừa nhập?')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('không bật cờ thì hành vi cũ nguyên vẹn: Esc đóng ngay dù đang gõ dở', async () => {
    const onOpenChange = vi.fn();
    renderWithI18n(
      <ConfirmProvider>
        <Dialog open onOpenChange={onOpenChange} title="Thêm thiết bị">
          <input aria-label="Mã máy" defaultValue="" />
        </Dialog>
      </ConfirmProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Mã máy' }), 'PC-01');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Bỏ những gì vừa nhập?')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/**
 * Hộp KHÔNG có `title` (nơi gọi tự dựng đầu/thân hộp) vẫn phải giữ hai lời hứa của hộp có
 * title: `guardUnsaved` thật sự canh ô nhập, và hộp mở từ bên trong nó được biết mình là
 * hộp lồng (nền trong suốt, không dim đôi).
 */
describe('Dialog không có title', () => {
  it('guardUnsaved vẫn canh: đã gõ thì Esc hỏi lại, chưa đóng', async () => {
    const onOpenChange = vi.fn();
    renderWithI18n(
      <ConfirmProvider>
        <Dialog open onOpenChange={onOpenChange} guardUnsaved>
          <input aria-label="Ghi chú" defaultValue="" />
        </Dialog>
      </ConfirmProvider>,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Ghi chú' }), 'abc');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Bỏ những gì vừa nhập?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('hộp con mở cùng lúc bên trong nó dùng nền trong suốt', () => {
    renderWithI18n(
      <ConfirmProvider>
        <Dialog open onOpenChange={() => {}}>
          <p>Thân hộp cha</p>
          <Dialog open onOpenChange={() => {}} title="Hộp con">
            <p>Thân hộp con</p>
          </Dialog>
        </Dialog>
      </ConfirmProvider>,
    );
    const backdrops = Array.from(document.querySelectorAll('.modal-backdrop'));
    expect(backdrops).toHaveLength(2);
    expect(backdrops.filter((el) => !el.classList.contains('bare'))).toHaveLength(1);
  });
});
