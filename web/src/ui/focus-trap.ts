import { useEffect, useRef, type RefObject } from 'react';

/**
 * Giữ tiêu điểm bàn phím BÊN TRONG một lớp phủ, rồi trả nó về chỗ cũ khi lớp phủ đóng.
 *
 * ===== LỖ CẦN CHẶN (drawer 390px) =====
 *
 * Drawer điều hướng ở màn hẹp mở ra mà không quản lý tiêu điểm chút nào. Ba chuyện cùng lúc,
 * và chuyện đầu là chuyện nặng nhất:
 *
 *   1. Tiêu điểm ở nguyên nút mở, mà nút ấy nằm SAU `<nav>` trong DOM. Nên Tab tiếp theo đi
 *      vào NỘI DUNG TRANG, **không bao giờ vào được drawer** — người đi bàn phím mở được cái
 *      menu ra rồi không vào nổi nó.
 *   2. Không bẫy tiêu điểm: Tab đủ lâu là ra khỏi drawer trong khi drawer vẫn che kín màn hình
 *      và backdrop vẫn chặn chuột. Người dùng đang thao tác với thứ họ không nhìn thấy.
 *   3. Esc đóng drawer thì tiêu điểm rơi về `<body>` — lượt Tab kế tiếp bắt đầu lại từ đầu
 *      trang, không phải từ chỗ họ đang đứng.
 *
 * ===== VÌ SAO KHÔNG DÙNG `ui/dialog.tsx` (Radix) =====
 *
 * `docs/SHARED-REGISTRY.md` cấm tự dựng overlay, và đúng — với HỘP THOẠI. Drawer thì khác về
 * bản chất bố cục: nó là chính cái sidebar, nằm trong luồng flex của `.app-shell` ở desktop và
 * chỉ `position: fixed` ở ≤900px. Đẩy nó qua portal của Radix là dựng lại toàn bộ `.sidebar`
 * cho một bề ngang màn hình, tức hai bản sidebar phải giữ đồng bộ bằng tay — đúng thứ AD-15
 * cấm. Nên ở đây lấy phần HÀNH VI (bẫy tiêu điểm + trả về chỗ cũ) thành một hook dùng chung,
 * không lấy phần dựng DOM.
 *
 * ===== `capture: true`, CÓ CHỦ Ý =====
 *
 * Nghe ở pha bắt thì ta thấy phím Tab TRƯỚC mọi handler của phần tử bên trong. Nghe ở pha nổi
 * bọt thì một ô nhập tự xử lý Tab (và gọi `stopPropagation`) sẽ làm cái bẫy thủng đúng ở chỗ
 * khó thấy nhất.
 */

/**
 * Thứ tự Tab bên trong một node.
 *
 * `:not([disabled])` và `[tabindex]:not([tabindex="-1"])` là hai vế hay quên: nút đang tắt vẫn
 * khớp `button`, còn `tabindex="-1"` là "nhận tiêu điểm bằng mã, KHÔNG nằm trong vòng Tab" —
 * gom nó vào là bẫy nhảy tới một chỗ người dùng không bao giờ Tab tới được.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Lọc theo THUỘC TÍNH, không theo bố cục.
 *
 * Bản đầu lọc bằng `el.offsetParent !== null` — cách quen thuộc để hỏi "phần tử này có đang
 * hiện không". Nó SAI ở đây theo một kiểu đáng ghi lại: jsdom không có bộ dựng bố cục nên
 * `offsetParent` LUÔN `null`, tức phép lọc trả về danh sách rỗng và cái bẫy lặng lẽ không bẫy
 * gì — trong khi trên trình duyệt thật nó chạy đúng. Một hàng rào chỉ hỏng ở tầng kiểm thử là
 * hàng rào sẽ được "sửa" bằng cách nới bài kiểm.
 *
 * `hidden` và `aria-hidden` thì đọc được ở cả hai nơi, và chúng phủ đúng cách repo này giấu
 * điều khiển (xem mẫu node-thường-trực-kèm-`hidden` ở `command-palette.tsx`).
 */
function focusablesIn(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hidden && !el.closest('[hidden],[aria-hidden="true"]'),
  );
}

/**
 * @param active bật bẫy hay không. Tắt thì hook không làm gì — desktop giữ nguyên hành vi cũ.
 * @returns ref gắn vào node bao ngoài lớp phủ.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  active: boolean,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  /** Nơi trả tiêu điểm về — ghi lại TRƯỚC khi ta dời nó đi. */
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    returnTo.current = document.activeElement as HTMLElement | null;

    /*
     * Đưa tiêu điểm vào trong NGAY, không chờ người dùng Tab: nút mở nằm sau `<nav>` trong
     * DOM nên lượt Tab kế tiếp sẽ đi ra ngoài chứ không đi vào. Không có gì bấm được thì đặt
     * lên chính node bao ngoài (nó khai `tabIndex={-1}`), để phím Esc và trình đọc màn hình
     * vẫn có chỗ bám.
     */
    const first = focusablesIn(node)[0] ?? node;
    first.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusablesIn(node);
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const dau = items[0];
      const cuoi = items[items.length - 1];
      const dang = document.activeElement;

      if (!node.contains(dang)) {
        // Tiêu điểm đã lọt ra ngoài (bấm chuột vào nền, hoặc một lượt vá DOM) — kéo về.
        event.preventDefault();
        (event.shiftKey ? cuoi : dau).focus();
      } else if (event.shiftKey && (dang === dau || dang === node)) {
        event.preventDefault();
        cuoi.focus();
      } else if (!event.shiftKey && dang === cuoi) {
        event.preventDefault();
        dau.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      /*
       * Trả tiêu điểm về nút đã mở lớp phủ. Chỉ trả khi tiêu điểm hiện đang ở TRONG lớp phủ
       * hoặc đã rơi về `<body>`: người dùng vừa bấm chuột vào một ô khác trên trang thì lượt
       * trả về này sẽ giật tiêu điểm khỏi tay họ.
       */
      const dang = document.activeElement;
      const conTrongLopPhu = node.contains(dang);
      const roiVeBody = dang === document.body || dang === null;
      if (conTrongLopPhu || roiVeBody) returnTo.current?.focus?.();
    };
  }, [active]);

  return ref;
}
