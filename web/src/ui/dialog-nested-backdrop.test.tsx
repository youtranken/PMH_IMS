import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { Dialog } from '@/ui/dialog';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * HỘP LỒNG KHÔNG ĐƯỢC CHỒNG HAI LỚP NỀN MỜ — KỂ CẢ KHI HỘP CON Ở GỐC APP.
 *
 * ===== LỖ BÀI NÀY CANH =====
 *
 * Đo độ sâu hộp lồng chỉ bằng `DialogDepthContext`, tức bằng VỊ TRÍ TRONG CÂY REACT, thì
 * đúng cho đường của Két sắt (hộp con dựng bên trong `sheet-body` của hộp
 * cha), nhưng mù với đường phổ biến hơn hẳn:
 *
 *   `ConfirmProvider` dựng `ConfirmDialog` ở GỐC app, là anh em của `children` chứ không nằm
 *   trong hộp nào — nên nó luôn đọc ra `depth = 0` và luôn lấy nền ĐẶC.
 *
 * Mà `guardUnsaved` của chính `ui/dialog.tsx` gọi `askConfirm`: mọi hộp có canh dữ liệu chưa
 * lưu, khi bấm Esc, đều đẻ ra một lớp nền mờ THỨ HAI đè lên lớp của chính nó. Đo trên trình
 * duyệt thật: hai lớp `rgba(20, 26, 20, .44)` chồng nhau, không lớp nào `bare`.
 *
 * ===== BÀI NÀY HỎI GÌ =====
 *
 * Đúng một câu, và là câu người dùng nhìn thấy: khi hộp "bỏ hay ở lại" đang mở chồng lên form,
 * có BAO NHIÊU lớp nền mờ ĐẶC trên màn hình. Câu trả lời phải luôn là một.
 *
 * Không hỏi `depth`, không hỏi tên cơ chế: hai cơ chế (`DialogDepthContext` cho hộp lồng cùng
 * một commit, sổ hộp-đang-mở cho hộp ở nhánh khác) có thể đổi, nhưng lời hứa thì không.
 */
describe('Nền mờ không chồng lên nhau', () => {
  /** Form có canh dữ liệu chưa lưu — bấm Esc là nó hỏi lại qua `ConfirmProvider`. */
  function GuardedForm() {
    const [open, setOpen] = useState(true);
    return (
      <Dialog open={open} onOpenChange={setOpen} guardUnsaved title="Sửa hồ sơ">
        <label>
          Tên máy
          <input name="ten" />
        </label>
      </Dialog>
    );
  }

  const countOpenBackdrops = () => {
    const all = Array.from(document.querySelectorAll('.modal-backdrop'));
    return {
      total: all.length,
      dac: all.filter((el) => !el.classList.contains('bare')).length,
    };
  };

  it('Esc trên form đang gõ dở: hộp hỏi lại KHÔNG thêm một lớp nền đặc thứ hai', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ConfirmProvider>
        <GuardedForm />
      </ConfirmProvider>,
    );

    expect(countOpenBackdrops()).toEqual({ total: 1, dac: 1 });

    // Gõ dở rồi bấm Esc → `guardUnsaved` mở hộp "bỏ hay ở lại" ở GỐC app.
    await user.type(screen.getByLabelText('Tên máy'), 'SW-CORE-01');
    await user.keyboard('{Escape}');

    await screen.findByText('Bỏ những gì vừa nhập?');
    const after = countOpenBackdrops();
    expect(after.total).toBe(2);
    // Đây là cả bài kiểm: hai hộp, nhưng chỉ MỘT lớp làm tối trang.
    expect(after.dac).toBe(1);
  });

  it('hai hộp ANH EM cùng mở: lớp thứ hai trong suốt', async () => {
    function TwoSiblingDialogs() {
      // Đúng hình dạng `{a && <Dialog/>}{b && <Dialog/>}` — cả hai đều `depth = 0`, nên chỉ
      // sổ hộp-đang-mở mới phân biệt được chúng.
      return (
        <>
          <Dialog open onOpenChange={() => undefined} title="Hộp một">
            <p>một</p>
          </Dialog>
          <Dialog open onOpenChange={() => undefined} title="Hộp hai">
            <p>hai</p>
          </Dialog>
        </>
      );
    }
    renderWithI18n(
      <ConfirmProvider>
        <TwoSiblingDialogs />
      </ConfirmProvider>,
    );

    await screen.findByText('hai');
    expect(countOpenBackdrops()).toEqual({ total: 2, dac: 1 });
  });
});
