import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDialogPortal } from '@/ui/dialog';
import { useAnchoredMenu } from '@/ui/use-anchored-menu';

export interface RowAction {
  key: string;
  label: string;
  onSelect: () => void;
  /** Việc lấy đi cái gì đó (xóa · thanh lý · vô hiệu hóa) — chữ đỏ, và luôn xếp xuống cuối. */
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Menu ba chấm cho cột "Thao tác" của MỌI bảng danh sách (AD-15).
 *
 * Vì sao thay dãy nút phẳng: cột thao tác đã phình tới ba–năm cái nút cạnh nhau ("Sửa" ·
 * "Đưa vào kho thanh lý" · "Gán vào máy"), và cái nào cũng phải đủ rộng để đọc được chữ. Kết
 * quả là cột cuối chiếm gần nửa bề ngang bảng, đẩy những cột mang THÔNG TIN — seat, tình trạng
 * hạn — co lại tới mức phải cuộn ngang mới đọc hết. Người ta mở một bảng danh sách để ĐỌC;
 * thao tác là việc thỉnh thoảng mới làm, và trả thêm một cú bấm cho nó là đổi đúng hướng.
 *
 * Ba chấm cũng làm được thứ dãy nút phẳng không làm nổi: nó CHỖ NÀO CŨNG BẰNG NHAU. Trước đây
 * một dòng có ba nút, dòng dưới có một — mắt phải quét lại từng dòng để tìm nút mình cần, và
 * ở chế độ gập dọc trên điện thoại thì dãy nút tự xuống dòng thành hai tầng lệch nhau.
 *
 * Bàn phím theo chuẩn menu button (WAI-ARIA): Enter/Space/↓ mở, ↑↓ đi trong menu, Home/End
 * nhảy đầu–cuối, Esc đóng và TRẢ FOCUS về nút ba chấm. Không có phần này thì cột thao tác chỉ
 * còn bấm được bằng chuột — một bước lùi so với dãy nút mà nó thay thế.
 *
 * KHÔNG dùng cho hành động CHÍNH của một màn: nút "Duyệt"/"Từ chối" ở màn phiếu duyệt là toàn
 * bộ lý do màn đó tồn tại, giấu chúng sau một cú bấm là đắt hơn phần bề ngang tiết kiệm được.
 * Ở đó dùng nút phẳng, hoặc để nút chính bên ngoài và cho phần còn lại vào đây.
 */
export function RowActions({
  label,
  items,
}: {
  /** Tên khả truy cập của nút ba chấm — PHẢI nói rõ nó thuộc dòng nào ("Thao tác với LIC-01"). */
  label: string;
  items: RowAction[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const portal = useDialogPortal();
  const { refs, floatingStyles } = useAnchoredMenu(open, {
    placement: 'bottom-end',
    maxHeight: 320,
  });

  /*
   * Việc nguy hiểm xuống CUỐI, luôn luôn.
   *
   * Không phải để cho đẹp: "Xóa" nằm ngay dưới con trỏ lúc menu vừa bung ra là chỗ ngón tay
   * rơi vào khi bấm nhanh hai lần. Thứ tự ổn định giữa mọi bảng cũng có nghĩa là trí nhớ cơ
   * bắp dùng lại được — mục cuối cùng luôn là mục phải nghĩ trước khi bấm.
   */
  const ordered = [...items].sort(
    (a, b) => Number(a.danger ?? false) - Number(b.danger ?? false),
  );

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  /*
   * `ordered` là mảng MỚI mỗi lần render. Đưa nó vào mảng phụ thuộc của effect bên dưới thì
   * effect chạy lại sau MỌI lần render khi menu đang mở — và mỗi lần nó lại kéo focus về mục
   * đầu, nên phím ↓ trông như không có tác dụng. Giữ qua ref, effect chỉ nghe `open`.
   */
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  // Mở ra thì focus rơi vào mục đầu — không thì Tab tiếp theo nhảy ra ngoài menu vừa mở.
  useEffect(() => {
    if (!open) return;
    const list = orderedRef.current;
    const first = list.findIndex((item) => !item.disabled);
    itemRefs.current[first < 0 ? 0 : first]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        refs.domReference.current?.contains(target) ||
        refs.floating.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, refs.domReference, refs.floating]);

  /** Không có việc nào làm được thì KHÔNG vẽ nút — ba chấm bấm ra menu rỗng là một lời hứa hão. */
  if (ordered.length === 0) return null;

  const move = (from: number, delta: number) => {
    const total = ordered.length;
    for (let step = 1; step <= total; step += 1) {
      const next = (from + delta * step + total * total) % total;
      if (!ordered[next].disabled) {
        itemRefs.current[next]?.focus();
        return;
      }
    }
  };

  return (
    <div className="row-actions" ref={refs.setReference}>
      <button
        ref={triggerRef}
        type="button"
        className="ghost kebab"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          // Nhiều bảng có `onRowClick` mở trang chi tiết — không chặn thì bấm ba chấm cũng
          // rời trang, và menu bung ra trên một màn đang chuyển.
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === 'Escape' && open) {
            event.stopPropagation();
            close(false);
          }
        }}
      >
        {/* Ba chấm là HÌNH, tên nút nằm ở `aria-label` — trình đọc màn hình không đọc "…". */}
        <span aria-hidden="true">⋯</span>
      </button>

      {open &&
        createPortal(
          <div
            className="row-actions-menu"
            role="menu"
            aria-label={label}
            style={floatingStyles}
            ref={refs.setFloating}
            onKeyDown={(event) => {
              const index = itemRefs.current.findIndex((el) => el === document.activeElement);
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                move(-1, 1);
              } else if (event.key === 'End') {
                event.preventDefault();
                move(0, -1);
              } else if (event.key === 'Escape') {
                event.stopPropagation();
                close(true);
              } else if (event.key === 'Tab') {
                // Tab ra khỏi menu = đã xong với nó. Để mở thì menu nổi lại lơ lửng trên một
                // ô khác đang được focus.
                close(false);
              }
            }}
          >
            {ordered.map((item, index) => (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={item.danger ? 'ghost danger' : 'ghost'}
                onClick={(event) => {
                  event.stopPropagation();
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          portal ?? document.body,
        )}
    </div>
  );
}

/**
 * Tên khả truy cập chuẩn cho nút ba chấm.
 *
 * Mọi dòng cùng mang tên "Thao tác" thì `getByRole('button', { name: 'Thao tác' })` khớp cả
 * hai chục dòng, và trình đọc màn hình đọc hai chục nút giống hệt nhau. Kèm mã hồ sơ vào là
 * mỗi dòng có một cái tên riêng.
 */
export function useRowActionLabel(): (subject: string) => string {
  const { t } = useTranslation();
  return (subject: string) => t('common.actionsOf', { subject });
}
