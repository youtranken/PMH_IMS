import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Chevron } from '@/ui/chevron';
import { useAnchoredMenu } from '@/ui/use-anchored-menu';
import { useDialogPortal } from '@/ui/dialog';

export interface SelectOption {
  value: string;
  label: ReactNode;
}

/**
 * Select tùy biến (thay <select> native có popup vuông góc xấu). Menu bo góc + shadow theo
 * hệ Sunset Grove, mũi tên chevron THỐNG NHẤT với DatePicker. Menu PORTAL ra body +
 * position:fixed neo theo nút → KHÔNG bị overflow của sheet/table cắt VÀ không bị ancestor
 * có transform (modal animate) làm fixed neo sai (menu "văng khỏi" trigger). Tự lật lên khi
 * dưới thiếu chỗ. Keyboard: ↑/↓/Enter/Esc.
 */
export function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
  ariaLabel,
  className,
  disabled,
  failed,
}: {
  /**
   * Gắn lên chính nút mở menu, để `<Field htmlFor>` còn trỏ vào một điều khiển CÓ THẬT.
   *
   * Cần khi một ô đổi qua lại giữa `<input>` và `Select` tùy trạng thái (ô "IP trong" của
   * form NAT): nhánh nào thiếu `id` thì bấm vào nhãn không xảy ra gì, và `getByLabel` của
   * bài kiểm cũng không tìm ra ô.
   */
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  /** Nhãn khi chưa chọn (value=''). Nếu bỏ trống, hiện option đầu. */
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Nguồn lựa chọn HỎNG (không phải rỗng) — nơi gọi truyền `query.isError` vào đây.
   *
   * Thiếu cờ này thì `options=[]` và menu nói "— Không có lựa chọn —", một câu SAI đọc y hệt
   * lúc chưa ai khai danh mục. Ở ô bắt buộc của form thêm mới (Loại thiết bị, Vị trí, Nhà
   * mạng) nó khiến người dùng đi khai lại một mục đã có sẵn, hoặc kết luận hệ thống chưa cài
   * xong. Cùng một hàng rào với `Combobox.failed` — hai cửa này không được lệch nhau.
   */
  failed?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portal = useDialogPortal();

  const selected = options.find((o) => o.value === value);
  const label = selected ? selected.label : (placeholder ?? '—');

  /**
   * NỐI NÚT VỚI DANH SÁCH — `aria-controls` + `aria-activedescendant`.
   *
   * Menu PORTAL ra ngoài cây DOM của nút, nên không có hai thuộc tính này thì với trình đọc
   * màn hình chúng là hai thứ rời nhau: `aria-expanded` báo "đã mở", nhưng "mở cái gì" thì
   * không có câu trả lời, và ↑/↓ chỉ đổi lớp CSS `active` — một thay đổi hoàn toàn IM LẶNG.
   * Người dùng mù bấm mũi tên năm lần và nghe đúng năm lần không có gì.
   *
   * `aria-activedescendant` phải trỏ tới MỘT PHẦN TỬ CÓ THẬT, nên chỉ đặt khi menu đang mở.
   */
  const listId = useId();
  const optionId = (index: number) => `${listId}-o${index}`;

  const { refs, floatingStyles } = useAnchoredMenu(open, {
    matchWidth: true,
    maxHeight: 288,
  });

  // Mở → active = option đang chọn.
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setActive(idx < 0 ? 0 : idx);
  }, [open, options, value]);

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

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      className={`fsel${className ? ` ${className}` : ''}`}
      ref={refs.setReference}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="fsel-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setActive((i) =>
              e.key === 'ArrowDown'
                ? Math.min(i + 1, options.length - 1)
                : Math.max(i - 1, 0),
            );
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const o = options[active];
            if (o) choose(o.value);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <span className={selected ? 'fsel-val' : 'fsel-val ph'}>{label}</span>
        <Chevron className="fsel-caret" />
      </button>
      {open &&
        createPortal(
          <ul
            className="fsel-menu"
            id={listId}
            role="listbox"
            style={floatingStyles}
            ref={refs.setFloating}
          >
            {/* HỎNG được ưu tiên hơn RỖNG: khi không hỏi được thì "không có lựa chọn" là một
                câu khẳng định mà ta không có quyền nói. `role="alert"`, không `role="option"` —
                trình đọc màn hình phải đọc nó như cảnh báo, và ↓/Enter không chạm tới được. */}
            {failed ? (
              <li className="fsel-error" role="presentation">
                <span role="alert">{t('common.optionsLoadError')}</span>
              </li>
            ) : options.length === 0 ? (
              /* Không có lựa chọn nào → báo rõ thay vì ô nổi trống trơ (review D3). */
              <li className="fsel-none" role="presentation">
                {t('select.noOptions', '— Không có lựa chọn —')}
              </li>
            ) : null}
            {/*
                `<li role="presentation">`: `<ul role="listbox">` chỉ được chứa `option`, mà
                `<li>` trần cho ra `listbox > listitem > option` — một tầng `listitem` chen vào
                giữa. Giữ `<li>` (CSS `.fsel-menu` dựa vào nó), bỏ vai của nó đi. Hai hàng báo
                RỖNG/HỎNG ở trên cũng vậy: chúng không phải lựa chọn, và `aria-disabled` trên
                một hàng không có vai gì thì cũng không nói được với ai.

                `tabIndex={-1}`: mẫu `aria-activedescendant` đòi tiêu điểm DOM ở NGUYÊN trên nút
                mở. `<button>` mặc định `tabindex=0`, mà menu lại portal vào điểm neo của
                `dialog.tsx` — con CUỐI của `RD.Content`, sau cả `.sheet-footer`. Nên trong một
                form đang mở menu, gõ Tab đưa tiêu điểm xuống giữa danh sách, ĐỨNG SAU cả nút
                Lưu và Hủy.
            */}
            {options.map((o, i) => (
              <li key={o.value} role="presentation">
                <button
                  type="button"
                  id={optionId(i)}
                  role="option"
                  aria-selected={o.value === value}
                  tabIndex={-1}
                  className={`fsel-option${i === active ? ' active' : ''}${o.value === value ? ' sel' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o.value)}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>,
          portal ?? document.body,
        )}
    </div>
  );
}
