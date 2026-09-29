import { useEffect, useRef, useState } from 'react';

/**
 * VÙNG SỐNG THƯỜNG TRỰC — một node duy nhất, gắn một lần ở shell.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `ui/load-state.tsx` khai `<div role="status" aria-busy>` NGAY TRÊN node "đang tải" — tức
 * node và nội dung của nó sinh ra cùng một lượt. Trình đọc màn hình chỉ theo dõi những vùng
 * sống đã có mặt TRƯỚC đó, nên một node mới chèn vào kèm sẵn chữ thường không được đọc lên.
 * Kết quả: 39 chỗ "đang tải" trên toàn web đều CÂM với người dùng NVDA/JAWS — họ bấm một nút,
 * nội dung biến mất, và không nghe thấy gì cho tới khi dữ liệu về.
 *
 * Cùng một lỗi đã được nhận ra và vá HAI lần ở chỗ khác (`relation-map` `#rmap-cut-sum`, rồi
 * `command-palette`), mỗi lần vá tại chỗ. Bản DÙNG CHUNG trong `ui/` thì không ai vá — đúng
 * chiều ngược của AD-15.
 *
 * ===== VÌ SAO LÀ MỘT KHO NGOÀI REACT =====
 *
 * Vùng sống phải sống LÂU HƠN thứ nó nói về. `Loading` bị tháo khỏi cây ngay khi dữ liệu về,
 * nên nếu lời loan báo nằm trong chính nó thì nó biến mất trước khi được đọc. Kho nhỏ ở đây
 * nằm ngoài vòng đời của mọi màn; `LiveRegion` gắn một lần ở shell và không bao giờ tháo.
 *
 * ===== VÌ SAO LÀ MỘT TẬP, KHÔNG PHẢI MỘT BIẾN =====
 *
 * Bảng điều khiển dựng SÁU khối cùng lúc, mỗi khối một `<Loading/>`. Với một biến "chữ hiện
 * tại" thì khối thứ sáu tải xong sẽ XOÁ lời loan báo trong khi năm khối kia còn đang tải —
 * người dùng nghe "đang tải" rồi im bặt, và kết luận là xong. Giữ một tập các lời đang sống,
 * ai gỡ thì chỉ gỡ phần của mình.
 */

type Token = { text: string };

const dangSong = new Set<Token>();
const nguoiNghe = new Set<() => void>();

function baoDoi(): void {
  for (const goi of nguoiNghe) goi();
}

/** Chữ đang phải đọc — lời SỚM NHẤT còn sống, để nó không bị lời sau đá đi giữa chừng. */
function chuHienTai(): string {
  const dau = dangSong.values().next();
  return dau.done ? '' : dau.value.text;
}

/**
 * Loan báo một câu suốt thời gian component còn sống, rồi tự rút khi nó tháo đi.
 *
 * Dùng `useRef` giữ token để hai lượt render liên tiếp không đăng ký hai lời: tập sẽ phình ra
 * và lời cũ không bao giờ được gỡ.
 */
export function useAnnounce(text: string): void {
  const token = useRef<Token>({ text });
  token.current.text = text;

  useEffect(() => {
    const cua = token.current;
    dangSong.add(cua);
    baoDoi();
    return () => {
      dangSong.delete(cua);
      baoDoi();
    };
  }, []);

  useEffect(baoDoi, [text]);
}

/**
 * Node thật của vùng sống. Gắn MỘT lần, ở `AppRoutes` — trước cả shell, nên nó có mặt từ
 * trước lượt tải đầu tiên của mọi màn.
 *
 * `aria-live="polite"` chứ không `assertive`: "đang tải" không được cắt ngang câu người dùng
 * đang nghe dở. `role="status"` đi kèm để trình đọc cũ (chưa hiểu `aria-live`) vẫn nhận ra.
 */
export function LiveRegion() {
  const [text, setText] = useState(chuHienTai);

  useEffect(() => {
    const goi = () => setText(chuHienTai());
    nguoiNghe.add(goi);
    // Gọi ngay một lượt: một `Loading` có thể đã gắn trước node này trong cùng lượt render.
    goi();
    return () => {
      nguoiNghe.delete(goi);
    };
  }, []);

  return (
    <div className="sr-only" role="status" aria-live="polite">
      {text}
    </div>
  );
}
