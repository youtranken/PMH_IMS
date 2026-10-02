import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogPortal } from '@/ui/dialog';
import { useDisabledReason } from '@/ui/disabled-reason';
import { Chevron } from '@/ui/chevron';
import { KebabIcon } from '@/ui/glyph-icons';
import { useAnchoredMenu } from '@/ui/use-anchored-menu';

export interface RowAction {
  key: string;
  label: string;
  onSelect: () => void;
  /** Việc lấy đi cái gì đó (xóa · thanh lý · vô hiệu hóa) — chữ đỏ, và luôn xếp xuống cuối. */
  danger?: boolean;
  /**
   * Việc cần nghĩ trước khi bấm nhưng ĐẢO LẠI ĐƯỢC (khóa tạm, vô hiệu một mục danh mục): chữ
   * màu cảnh báo, đứng thành nhóm riêng giữa việc thường và việc `danger`. Tô đỏ cả việc đảo
   * được lẫn việc không đảo được thì màu đỏ hết nghĩa là "không quay lại được".
   */
  warn?: boolean;
  /**
   * Việc đảo ngược theo chiều TỐT ("Dùng lại" một mục đã ngừng, "Mở khóa"): chữ xanh, đứng cùng
   * nhóm việc thường. Nó là nghịch đảo của một việc `warn`; không tô thì trông y hệt việc
   * thường và người ta không nhận ra đây là lối quay lại.
   */
  ok?: boolean;
  disabled?: boolean;
  /**
   * Việc ÍT KHI làm và dễ nhầm với một việc khác trong cùng menu (vd "Ẩn hồ sơ" nhập nhầm cạnh
   * "Thu hồi"): chữ xám, xếp SAU cả việc nguy hiểm, có đường kẻ ngăn phía trên.
   */
  muted?: boolean;
  /**
   * Dòng mô tả nhỏ dưới nhãn — nói việc này để lại gì ("trả IP về pool, giữ lịch sử"). Chỉ để
   * đọc (`aria-hidden`): tên của mục vẫn đúng là `label`, bài kiểm và trình đọc màn hình không đổi.
   */
  hint?: string;
}

/**
 * Nút chính đứng NGOÀI menu — theo Q-18 là "Sửa": việc hằng ngày không đáng thêm một cú bấm.
 */
export interface RowPrimaryAction {
  /** Chữ trên nút ("Sửa"). */
  label: string;
  /**
   * Tên khả truy cập — NÊN kèm định danh dòng ("Sửa máy PC-01"): hai chục nút "Sửa" cùng tên
   * thì trình đọc màn hình đọc y hệt nhau và `getByRole` khớp cả hai chục.
   */
  ariaLabel?: string;
  onClick: () => void;
  /** Tắt tạm trong lúc một việc khác của dòng đang chạy — không cần giải thích. */
  disabled?: boolean;
  /**
   * Có lý do thì nút vẫn ĐỨNG ĐÓ nhưng tắt, lý do gắn bằng `aria-describedby` — ẩn nút đi thì
   * hàng lệch cột và người dùng không biết vì sao không sửa được.
   */
  disabledReason?: string | null;
}

/**
 * Menu ba chấm (dọc) cho cột "Thao tác" của MỌI bảng danh sách (AD-15).
 *
 * Vì sao thay dãy nút phẳng: cột thao tác đã phình tới ba–năm cái nút cạnh nhau ("Sửa" ·
 * "Đưa vào kho thanh lý" · "Gán vào máy"), và cái nào cũng phải đủ rộng để đọc được chữ. Kết
 * quả là cột cuối chiếm gần nửa bề ngang bảng, đẩy những cột mang THÔNG TIN — seat, tình trạng
 * hạn — co lại tới mức phải cuộn ngang mới đọc hết. Người ta mở một bảng danh sách để ĐỌC;
 * thao tác là việc thỉnh thoảng mới làm, và trả thêm một cú bấm cho nó là đổi đúng hướng.
 *
 * Ba chấm cũng làm được thứ dãy nút phẳng không làm nổi: nó CHỖ NÀO CŨNG BẰNG NHAU. Với dãy nút
 * phẳng, một dòng có ba nút, dòng dưới có một — mắt phải quét lại từng dòng để tìm nút mình cần, và
 * ở chế độ gập dọc trên điện thoại thì dãy nút tự xuống dòng thành hai tầng lệch nhau.
 *
 * Bàn phím theo chuẩn menu button (WAI-ARIA): Enter/Space/↓ mở, ↑↓ đi trong menu, Home/End
 * nhảy đầu–cuối, Esc đóng và TRẢ FOCUS về nút ba chấm. Không có phần này thì cột thao tác chỉ
 * còn bấm được bằng chuột — một bước lùi so với dãy nút mà nó thay thế.
 *
 * KHÔNG dùng cho hành động CHÍNH của một màn: nút "Duyệt"/"Từ chối" ở màn phiếu duyệt là toàn
 * bộ lý do màn đó tồn tại, giấu chúng sau một cú bấm là đắt hơn phần bề ngang tiết kiệm được.
 * Ở đó dùng nút phẳng, hoặc để nút chính bên ngoài và cho phần còn lại vào đây.
 *
 * `primary` vẽ nút chính ("Sửa", Q-18) cạnh ba chấm trong `.action-cell` — mọi bảng cùng một
 * bố cục, không tự dựng lại cặp nút + menu ở từng màn.
 */
export function RowActions({
  primary,
  ...menu
}: {
  primary?: RowPrimaryAction;
  label: string;
  items: RowAction[];
  subject?: string;
  /**
   * Nút mở menu là nút CHỮ ("Xuất Excel" + mũi tên) thay vì ba chấm — cho menu nhỏ ở đầu trang
   * (`ExportXlsxButton` có `allUrl`). Bàn phím, thứ tự, vạch ngăn giữ nguyên như menu dòng.
   */
  triggerText?: string;
}) {
  const reason = useDisabledReason(primary?.disabledReason);
  if (!primary) return <RowActionsMenu {...menu} />;
  return (
    <div className="action-cell">
      <button
        type="button"
        className="btn sm ghost"
        aria-label={primary.ariaLabel}
        disabled={primary.disabled || Boolean(primary.disabledReason)}
        {...reason.buttonProps}
        onClick={(event) => {
          // Cùng lý do với nút ba chấm: dòng có `onRowClick` thì bấm Sửa cũng rời trang.
          event.stopPropagation();
          primary.onClick();
        }}
      >
        {primary.label}
      </button>
      {reason.hint}
      <RowActionsMenu {...menu} />
    </div>
  );
}

function RowActionsMenu({
  label,
  items,
  subject,
  triggerText,
}: {
  /** Tên khả truy cập của nút ba chấm — PHẢI nói rõ nó thuộc dòng nào ("Thao tác với LIC-01"). */
  label: string;
  items: RowAction[];
  /**
   * Tên dòng hiện ở ĐẦU menu ("admin · SW-01"). Nên truyền khi menu có việc phá hủy, hoặc khi
   * bảng rộng có thể đang cuộn mất cột định danh: nhìn menu là biết mình sắp Thu hồi cái gì.
   */
  subject?: string;
  triggerText?: string;
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
  const rank = (item: RowAction) => (item.muted ? 3 : item.danger ? 2 : item.warn ? 1 : 0);
  const ordered = [...items].sort((a, b) => rank(a) - rank(b));

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus({ preventScroll: true });
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
    /*
     * `preventScroll`: lúc này Floating UI chưa đặt vị trí, và focus kèm cuộn sẽ kéo các khung
     * cuộn tổ tiên (bảng rộng, thân hộp thoại) — bảng trượt ngang, cột định danh biến mất
     * đúng lúc người dùng sắp chọn việc phá hủy.
     */
    itemRefs.current[first < 0 ? 0 : first]?.focus({ preventScroll: true });
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
        itemRefs.current[next]?.focus({ preventScroll: true });
        return;
      }
    }
  };

  return (
    <div className="row-actions" ref={refs.setReference}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerText ? 'btn with-icon' : 'ghost kebab'}
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
        {/* Ba chấm DỌC ở mọi màn (Q-18). Là HÌNH, tên nút nằm ở `aria-label` — trình đọc màn
            hình không đọc ký tự, và bài E2E tìm nút theo tên nên đổi hình không đổi bài. */}
        {triggerText ? (
          <>
            {triggerText}
            <Chevron />
          </>
        ) : (
          <KebabIcon />
        )}
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
                // ô khác đang được focus. Menu portal ra cuối body nên bước Tab tự nhiên rơi
                // về đầu trang — chặn nó và trả focus về nút ⋮, Tab tiếp đi đúng thứ tự dòng.
                event.preventDefault();
                close(true);
              }
            }}
          >
            {subject ? (
              // Chữ để đọc, không phải mục bấm: tên của menu đã nằm ở `aria-label`.
              <div className="row-actions-subject" aria-hidden="true">
                {subject}
              </div>
            ) : null}
            {ordered.map((item, index) => [
              /* Vạch ngăn giữa hai NHÓM mức độ (thường · cảnh báo · nguy hiểm · hiếm): hai việc
                 khác hẳn hệ quả đứng sát nhau là chỗ ngón tay trượt nhầm trên điện thoại. Là
                 `role="separator"` để trình đọc màn hình cũng nghe ra ranh giới nhóm. */
              index > 0 && rank(ordered[index - 1]) !== rank(item) ? (
                <div key={`sep-${item.key}`} role="separator" className="ra-sep" />
              ) : null,
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={
                  item.muted
                    ? 'ghost is-muted'
                    : item.danger
                      ? 'ghost danger'
                      : item.warn
                        ? 'ghost warn'
                        : item.ok
                          ? 'ghost ok'
                          : 'ghost'
                }
                onClick={(event) => {
                  event.stopPropagation();
                  close(true);
                  item.onSelect();
                }}
              >
                {item.hint ? (
                  <span className="ra-text">
                    {item.label}
                    <small className="ra-hint" aria-hidden="true">
                      {item.hint}
                    </small>
                  </span>
                ) : (
                  item.label
                )}
              </button>,
            ])}
          </div>,
          portal ?? document.body,
        )}
    </div>
  );
}
