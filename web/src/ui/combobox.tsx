import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Chevron } from '@/ui/chevron';
import { useAnchoredMenu } from '@/ui/use-anchored-menu';
import { useDialogPortal } from '@/ui/dialog';

interface ComboboxProps<T> {
  placeholder: string;
  query: string;
  onQuery: (value: string) => void;
  options: T[];
  getKey: (option: T) => string;
  /** Nội dung một dòng gợi ý (dùng <span> cho nhãn chính, <small> cho phụ). */
  renderOption: (option: T) => ReactNode;
  onSelect: (option: T) => void;
  disabled?: boolean;
  /** Tên trợ năng khi ô không có `<label>` trỏ tới (placeholder là tên dự phòng). */
  ariaLabel?: string;
  /** Dòng ghim ở ĐẦU menu, vd "+ Thêm router mới" — luôn hiện, kể cả khi lọc ra rỗng. */
  action?: { label: string; onClick: () => void };
  /**
   * Nguồn gợi ý HỎNG (không phải rỗng) — nơi gọi truyền `query.isError` vào đây.
   *
   * Mọi nơi gọi đều viết `options={q.data?.items ?? []}`, nên một lỗi 500 rơi vào đúng hình
   * dạng của "tìm không ra". Người dùng đọc sự im lặng đó thành "hệ thống không có máy này"
   * rồi khai một máy trùng, hoặc chọn đại máy khác — cả hai đều ghi vào DB và không tự sửa.
   */
  failed?: boolean;
}

/**
 * Autocomplete có style dùng chung (thay <ul><li><button> trần).
 * Menu chỉ hiện khi có kết quả — parent tự fetch theo query (debounce ở parent).
 * Điều hướng: ↑/↓ chọn dòng, Enter chốt, Esc đóng menu.
 * Menu PORTAL ra body + position:fixed neo theo ô input → KHÔNG bị overflow của .sheet-body /
 * bảng cắt (trước đây gợi ý mở gần đáy popup Chuyển/Sửa bị che). Tự lật lên khi dưới thiếu chỗ.
 */
export function Combobox<T>({
  placeholder,
  query,
  onQuery,
  options,
  getKey,
  renderOption,
  onSelect,
  disabled,
  ariaLabel,
  action,
  failed,
}: ComboboxProps<T>) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false);
  /**
   * Menu chỉ mở SAU KHI người dùng chạm vào ô (focus, gõ, hoặc bấm mũi tên).
   *
   * Không có cờ này thì ô nào có sẵn danh sách sẽ tự bung menu ngay lúc hộp thoại hiện ra —
   * che mất các ô bên dưới và buộc người dùng bấm ra chỗ khác để đóng, trước cả khi họ kịp
   * đọc form. Với ô kiểu gõ-để-tìm thì không đổi gì: phải gõ mới có gợi ý, mà gõ là đã chạm.
   */
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const portal = useDialogPortal();

  // options đổi (query mới) → về đầu danh sách và mở lại menu
  useEffect(() => {
    setActive(0);
    setClosed(false);
  }, [options]);

  // `failed` cũng mở menu: người dùng phải THẤY câu "không tải được" ở đúng chỗ họ đang nhìn,
  // chứ không phải suy ra từ việc gõ mãi không thấy gì.
  const open = touched && !closed && (options.length > 0 || action !== undefined || failed === true);
  const { refs, floatingStyles } = useAnchoredMenu(open, {
    matchWidth: true,
    maxHeight: 260,
  });

  // Bấm ngoài đóng menu (menu ở portal, không nằm trong .combo).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        refs.domReference.current?.contains(target) ||
        refs.floating.current?.contains(target)
      )
        return;
      setClosed(true);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, refs.domReference, refs.floating]);

  const choose = (option: T) => {
    onSelect(option);
    setClosed(true);
    /*
     * Trả về "chưa chạm" luôn, không chỉ đóng.
     *
     * `onSelect` thường làm `options` đổi (nơi gọi xoá từ khoá lọc, hoặc danh sách được tính
     * lại theo giá trị vừa chọn), và effect `[options]` ngay trên lại `setClosed(false)` —
     * menu vừa đóng đã bung lại ngay. Đặt `touched = false` khiến điều kiện `open` không thể
     * bật lên cho tới khi người dùng thật sự chạm vào ô lần nữa, đúng ý nghĩa của cờ này.
     */
    setTouched(false);
  };

  // Mũi tên bung/đóng như dropdown: đóng → mở lại (nếu có gợi ý) và focus để gõ lọc.
  const toggle = () => {
    if (open) {
      setClosed(true);
    } else {
      setTouched(true);
      setClosed(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className={`combo${open ? ' open' : ''}`} ref={refs.setReference}>
      <input
        ref={inputRef}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => setTouched(true)}
        onChange={(e) => {
          setTouched(true);
          onQuery(e.target.value);
          setClosed(false);
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const option = options[active];
            if (option) choose(option);
          } else if (e.key === 'Escape') {
            // đóng menu tại chỗ — KHÔNG để Escape lan lên đóng cả modal
            e.stopPropagation();
            setClosed(true);
          }
        }}
      />
      {/* Mũi tên chevron THỐNG NHẤT với Select/DatePicker — bấm để bung/đóng danh sách. */}
      <button
        type="button"
        className="combo-caret"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onClick={toggle}
      >
        <Chevron />
      </button>
      {open &&
        createPortal(
          <ul
            className="combo-menu"
            ref={refs.setFloating}
            role="listbox"
            style={floatingStyles}
          >
            {/* Dòng "tạo mới" ghim ở đầu, KHÔNG nằm trong danh sách chọn: nó không phải một
                lựa chọn, và phải với tới được cả khi lọc ra rỗng — đúng lúc người dùng cần
                nó nhất là lúc thứ họ tìm chưa tồn tại. */}
            {action ? (
              <li className="combo-action-row">
                <button
                  type="button"
                  className="combo-option combo-action"
                  onClick={() => {
                    setClosed(true);
                    action.onClick();
                  }}
                >
                  {action.label}
                </button>
              </li>
            ) : null}
            {/* Dòng báo hỏng: KHÔNG mang `role="option"`, nên ↓/Enter không chạm tới được và
                trình đọc màn hình không đọc nó lên như một thiết bị có thật. `role="alert"`
                để NVDA đọc ngay lúc nó xuất hiện. Danh sách cũ (nếu còn trong cache) vẫn giữ
                nguyên bên dưới — giấu đi là lấy mất thứ đang còn dùng được. */}
            {failed ? (
              <li className="combo-error" role="presentation">
                <span role="alert">{t('common.optionsLoadError')}</span>
              </li>
            ) : null}
            {options.map((option, i) => (
              <li key={getKey(option)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  disabled={disabled}
                  className={`combo-option${i === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(option)}
                >
                  {renderOption(option)}
                </button>
              </li>
            ))}
          </ul>,
          portal ?? document.body,
        )}
    </div>
  );
}
