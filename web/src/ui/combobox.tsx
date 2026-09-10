import { useEffect, useId, useRef, useState } from 'react';
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

  /**
   * NỐI Ô GÕ VỚI DANH SÁCH — `aria-controls` + `aria-activedescendant`.
   *
   * Menu PORTAL ra ngoài cây DOM của ô input, nên thiếu hai thuộc tính này thì với trình đọc
   * màn hình chúng là hai thứ rời nhau: `role="combobox"` + `aria-expanded` báo "đã mở",
   * nhưng "mở cái gì" thì không có câu trả lời, và ↑/↓ chỉ đổi lớp CSS `active` — một thay
   * đổi hoàn toàn IM LẶNG. Người dùng mù bấm mũi tên năm lần và nghe đúng năm lần không có
   * gì; cả cơ chế điều hướng bàn phím tồn tại mà không tới được họ.
   *
   * `aria-activedescendant` phải trỏ tới MỘT PHẦN TỬ CÓ THẬT — chỉ đặt khi menu đang mở và
   * dòng đang chọn thật sự tồn tại (menu có thể chỉ chứa dòng "tạo mới" hoặc dòng báo hỏng).
   */
  const listId = useId();
  const optionId = (index: number) => `${listId}-o${index}`;

  /*
   * ===== "OPTIONS ĐỔI" PHẢI ĐO BẰNG NỘI DUNG, KHÔNG PHẢI BẰNG IDENTITY (10/09) =====
   *
   * Bản cũ nghe `[options]` và làm hai việc: `setActive(0)` + `setClosed(false)`. Cả hai đều
   * sai nhịp, vì `options` gần như KHÔNG BAO GIỜ ổn định về identity ở nơi gọi thật:
   * `SuggestInput` dựng `filtered` bằng `useMemo([options, term])`, `use-departments.ts` trả
   * `.filter().map()` — mảng MỚI sau mỗi lần cha render, kể cả khi nội dung y hệt.
   *
   * Nên effect chạy sau MỌI lần cha render, và `setClosed(false)` bung lại đúng cái menu người
   * dùng vừa bấm Esc để đóng: mở hộp Chuyển → bấm ô "Người/bộ phận dùng" → Esc → gõ tiếp vào
   * ô "Lý do" → menu bung lại, đè lên chính ô đang gõ. Esc không còn là một đường thoát.
   *
   * `choose()` đã gặp đúng cơ chế này và vá riêng cho đường CHỌN bằng `touched = false`; đây
   * là chỗ vá cho phần còn lại.
   *
   * HAI VIỆC TÁCH LÀM HAI:
   *   - Về đầu danh sách: chỉ khi DANH SÁCH thật sự khác — so bằng khóa, không bằng ô nhớ.
   *     (Trước đây bấm ↓ ba lần rồi cha render một cái là dòng đang sáng nhảy về đầu.)
   *   - Mở lại menu: chuyển hẳn về các handler của NGƯỜI DÙNG — gõ (`onChange`), chạm vào ô
   *     (`onFocus`), bấm mũi tên (`toggle`). Cha render lại không phải một hành vi của người
   *     dùng, nên nó không được mở gì cả.
   */
  const optionKeys = JSON.stringify(options.map(getKey));
  useEffect(() => {
    setActive(0);
  }, [optionKeys]);

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
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        aria-autocomplete="list"
        /* Chạm vào ô là một hành vi CÓ Ý của người dùng → mở lại menu đã đóng bằng Esc.
           Esc không làm rơi tiêu điểm, nên sự kiện này KHÔNG bắn ngay sau Esc: muốn mở lại
           thì phải rời ô rồi quay lại, hoặc gõ tiếp — đúng ý "người dùng chủ động". */
        onFocus={() => {
          setTouched(true);
          setClosed(false);
        }}
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
            id={listId}
            ref={refs.setFloating}
            role="listbox"
            style={floatingStyles}
          >
            {/* Dòng "tạo mới" ghim ở đầu, KHÔNG nằm trong danh sách chọn: nó không phải một
                lựa chọn, và phải với tới được cả khi lọc ra rỗng — đúng lúc người dùng cần
                nó nhất là lúc thứ họ tìm chưa tồn tại. */}
            {action ? (
              <li className="combo-action-row" role="presentation">
                <button
                  type="button"
                  tabIndex={-1}
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
            {/*
                `<li role="presentation">`: `<ul role="listbox">` chỉ được chứa `option`, mà
                `<li>` trần thì cây trợ năng đọc ra `listbox > listitem > option` — một tầng
                `listitem` chen vào giữa. `combo-error` ngay trên đã làm đúng từ đầu; hàng bọc
                dòng chọn thì chưa. Giữ `<li>` (CSS `.combo-menu` dựa vào nó), bỏ vai của nó đi.

                `tabIndex={-1}`: mẫu `aria-activedescendant` đòi tiêu điểm DOM ở NGUYÊN trên ô
                gõ. `<button>` mặc định `tabindex=0`, mà menu lại portal vào điểm neo của
                `dialog.tsx` — con CUỐI của `RD.Content`, sau cả `.sheet-footer`. Nên trong một
                form đang mở gợi ý, gõ Tab đưa tiêu điểm xuống giữa danh sách, ĐỨNG SAU cả nút
                Lưu và Hủy.

                `aria-selected={false}`: "đang sáng" KHÔNG phải "đã chọn". Bản cũ đặt
                `i === active`, nên mỗi lần bấm ↓ trình đọc màn hình đọc "đã chọn" cho một dòng
                người dùng mới chỉ lướt qua, trong khi ô gõ chưa nhận giá trị nào. Việc đang
                sáng đã do `aria-activedescendant` nói ra rồi. `Select` có `value` nên nó so
                với `value` thật; `Combobox` là ô gõ tự do, danh sách gợi ý không mang lựa chọn.
            */}
            {options.map((option, i) => (
              <li key={getKey(option)} role="presentation">
                <button
                  type="button"
                  id={optionId(i)}
                  role="option"
                  aria-selected={false}
                  tabIndex={-1}
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
