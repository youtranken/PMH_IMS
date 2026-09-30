import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useDialogPortal } from '@/ui/dialog';
import { useAnchoredMenu } from '@/ui/use-anchored-menu';

/** Rời chuột khỏi nút rồi mới sang bong bóng (cách 4px) — không có quãng trễ là bong bóng tắt giữa đường. */
const HOVER_CLOSE_MS = 150;

/**
 * Nút (i) nhỏ cạnh tiêu đề/nhãn, bấm (hoặc rê chuột) thì hiện một câu giải thích ngắn.
 *
 * Là disclosure chứ không phải tooltip thuần: tooltip chỉ hiện khi rê chuột thì trên điện thoại
 * không ai mở được, và người đi bàn phím phải đoán. Nên cú bấm/Enter/Space là đường CHÍNH;
 * rê chuột chỉ là lối tắt cho người dùng chuột.
 *
 * Bong bóng portal vào điểm neo của `Dialog` (hoặc `body`): `Dialog` coi "điểm neo có con" là
 * "đang có popover mở", nên Escape chỉ đóng bong bóng chứ không đóng cả hộp. `position: fixed`
 * qua `useAnchoredMenu` để khung cuộn của hộp không cắt mất nó, và `shift` giữ nó trong 390px.
 */
export function InfoTip({ subject, children }: { subject: string; children: ReactNode }) {
  const { t } = useTranslation();
  const id = useId();
  const portal = useDialogPortal();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const hoverTimer = useRef<number | undefined>(undefined);
  const { refs, floatingStyles } = useAnchoredMenu(open, { placement: 'bottom-start', maxHeight: 280 });

  const closeAll = () => {
    window.clearTimeout(hoverTimer.current);
    setPinned(false);
    setHovered(false);
  };

  const hoverIn = (pointerType: string) => {
    // Chạm cũng bắn pointerenter: mở theo "rê" rồi cú chạm lại đóng ngay là nút không bao giờ mở.
    if (pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer.current);
    setHovered(true);
  };
  const hoverOut = (pointerType: string) => {
    if (pointerType !== 'mouse') return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHovered(false), HOVER_CLOSE_MS);
  };

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (refs.domReference.current?.contains(target) || refs.floating.current?.contains(target)) return;
      closeAll();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, refs.domReference, refs.floating]);

  return (
    <span className="info-tip">
      <button
        ref={refs.setReference}
        type="button"
        className="info-tip-btn"
        aria-label={t('common.infoTipOf', { subject })}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => hoverIn(event.pointerType)}
        onPointerLeave={(event) => hoverOut(event.pointerType)}
        onClick={(event) => {
          // Trong nhãn của một dòng bảng có `onRowClick` — bấm (i) không được mở dòng.
          event.stopPropagation();
          // Đang hiện vì rê chuột thì cú bấm GHIM lại; đóng mới là cú bấm kế tiếp.
          if (hovered && !pinned) setPinned(true);
          else if (open) closeAll();
          else setPinned(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.stopPropagation();
            closeAll();
          }
        }}
        onBlur={closeAll}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              id={id}
              className="info-tip-pop"
              ref={refs.setFloating}
              style={floatingStyles}
              onPointerEnter={(event) => hoverIn(event.pointerType)}
              onPointerLeave={(event) => hoverOut(event.pointerType)}
              // Bấm vào chữ (để bôi chép) không được lấy tiêu điểm khỏi nút — mất tiêu điểm là đóng.
              onMouseDown={(event) => event.preventDefault()}
            >
              {children}
            </div>,
            portal ?? document.body,
          )
        : null}
    </span>
  );
}
