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
  /**
   * Nguồn lựa chọn ĐANG TẢI — nơi gọi truyền `query.isPending` vào đây.
   *
   * Thiếu cờ này thì "chưa biết" và "không có gì khớp" đọc y hệt nhau: trong lúc danh mục còn
   * bay, `options` là `[]` và menu nói "không có dịch vụ nào khớp" kèm dòng "＋ Khai mới".
   * Người dùng được MỜI đi khai trùng một dịch vụ đã có — và cái khai trùng ấy vào DB.
   *
   * Cùng họ với `failed`: ba trạng thái, ba câu. `failed` phân biệt "hỏng" với "rỗng";
   * `pending` phân biệt "chưa biết" với "rỗng".
   */
  pending?: boolean;
  /**
   * Câu hiện khi LỌC KHÔNG RA — khác `failed` (nguồn hỏng) và khác im lặng.
   *
   * Không truyền thì menu chỉ còn mỗi dòng `action` (nếu có), tức người dùng gõ một từ rồi
   * nhìn vào một khoảng trống và phải tự đoán: chưa khai? gõ sai? hay hệ thống đang nghĩ?
   * Truyền vào thì đó là chỗ nói cho họ biết phải làm gì tiếp.
   *
   * `role="presentation"` chứ không `option`: nó không phải một thiết bị chọn được, nên
   * ↓/Enter không được chạm tới và trình đọc màn hình không được đọc nó như một lựa chọn.
   * Cũng KHÔNG `role="alert"` như dòng báo hỏng — lọc không ra là kết quả bình thường của
   * một phép lọc, không phải sự cố, và cắt ngang người đang gõ để báo chuyện thường là thói
   * quen làm người ta thôi nghe.
   */
  empty?: ReactNode;
  /**
   * Ô BẮT BUỘC. Khác `Select`, `Combobox` render ra một `<input>` THẬT, nên đây là `required`
   * của TRÌNH DUYỆT — chặn submit thật, không chỉ là một thuộc tính `aria`.
   *
   * Dấu `*` của `Field` có HAI hành vi tuỳ điều khiển bên dưới, và người viết form không có
   * cách nào biết mình đang được vế nào. Nên
   * `Combobox` có vế đầy đủ, `Select` có vế `aria` (nó là `<button>`, không có gì hơn để cho).
   */
  required?: boolean;
  /**
   * `id` của chính `<input>`.
   *
   * `Field` nhả `htmlFor` vào đứa con của nó; `Combobox` không nhận `id` thì `htmlFor`
   * **không dùng được** với nó — bấm vào nhãn không đưa tiêu điểm vào ô, và `getByLabel` của
   * bài kiểm không tìm ra nó.
   *
   * Nhận qua props chứ không tự sinh bằng `useId`: `Field` là bên biết cả nhãn lẫn ô, nên nó
   * phải là bên đặt tên. Tự sinh ở đây thì hai bên sinh hai id và chẳng bên nào nối được với ai.
   */
  id?: string;
  /**
   * Dấu ở mép phải ô. `suggest` (ô gõ tự do có gợi ý — `SuggestInput`) vẽ biểu tượng danh
   * sách thay cho mũi tên: mũi tên là hình của ô CHỌN, người dùng thấy nó thì không dám gõ.
   */
  caret?: 'chevron' | 'suggest';
  /** Nối `hint`/`error` của `Field` vào ô — `Field` tự truyền, nơi gọi không phải biết. */
  'aria-describedby'?: string;
  /** Ô đang báo lỗi — `Field error` tự truyền; viền đỏ và tiêu điểm của `useFormErrors` bám vào đây. */
  'aria-invalid'?: boolean;
}

/**
 * Autocomplete có style dùng chung (thay <ul><li><button> trần).
 * Menu chỉ hiện khi có kết quả — parent tự fetch theo query (debounce ở parent).
 * Điều hướng: ↑/↓ chọn dòng, Enter chốt, Esc đóng menu.
 * Menu PORTAL ra body + position:fixed neo theo ô input → KHÔNG bị overflow của .sheet-body /
 * bảng cắt (gợi ý mở gần đáy popup Chuyển/Sửa không bị che). Tự lật lên khi dưới thiếu chỗ.
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
  pending,
  empty,
  required,
  id,
  caret = 'chevron',
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
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
   * ===== "OPTIONS ĐỔI" PHẢI ĐO BẰNG NỘI DUNG, KHÔNG PHẢI BẰNG IDENTITY =====
   *
   * Đừng nghe `[options]` để làm `setActive(0)` + `setClosed(false)`. Cả hai đều sẽ sai nhịp,
   * vì `options` gần như KHÔNG BAO GIỜ ổn định về identity ở nơi gọi thật:
   * `SuggestInput` dựng `filtered` bằng `useMemo([options, term])`, `use-departments.ts` trả
   * `.filter().map()` — mảng MỚI sau mỗi lần cha render, kể cả khi nội dung y hệt.
   *
   * Nên effect chạy sau MỌI lần cha render, và `setClosed(false)` bung lại đúng cái menu người
   * dùng vừa bấm Esc để đóng: mở hộp Chuyển → bấm ô "Người/phòng ban dùng" → Esc → gõ tiếp vào
   * ô "Lý do" → menu bung lại, đè lên chính ô đang gõ. Esc không còn là một đường thoát.
   *
   * `choose()` đã gặp đúng cơ chế này và vá riêng cho đường CHỌN bằng `touched = false`; đây
   * là chỗ vá cho phần còn lại.
   *
   * HAI VIỆC TÁCH LÀM HAI:
   *   - Về đầu danh sách: chỉ khi DANH SÁCH thật sự khác — so bằng khóa, không bằng ô nhớ.
   *     (So bằng ô nhớ thì bấm ↓ ba lần rồi cha render một cái là dòng đang sáng nhảy về đầu.)
   *   - Mở lại menu: chuyển hẳn về các handler của NGƯỜI DÙNG — gõ (`onChange`), chạm vào ô
   *     (`onFocus`), bấm mũi tên (`toggle`). Cha render lại không phải một hành vi của người
   *     dùng, nên nó không được mở gì cả.
   */
  const optionKeys = JSON.stringify(options.map(getKey));
  useEffect(() => {
    setActive(0);
  }, [optionKeys]);

  /*
   * `failed` cũng mở menu: người dùng phải THẤY câu "không tải được" ở đúng chỗ họ đang
   * nhìn, chứ không phải suy ra từ việc gõ mãi không thấy gì.
   *
   * `empty` cũng vậy — và đây là chỗ dễ quên nhất khi thêm một trạng thái mới: viết xong
   * phần RENDER mà không mở menu thì câu ấy không bao giờ hiện ra, và bài kiểm duy nhất bắt
   * được là bài đi qua đúng đường người dùng đi (nó báo "không tìm thấy listbox" chứ không
   * phải "không tìm thấy chữ", tức menu chưa từng mở).
   */
  const open =
    touched &&
    !closed &&
    (options.length > 0 ||
      action !== undefined ||
      failed === true ||
      pending === true ||
      empty !== undefined);
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
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={query}
        disabled={disabled}
        role="combobox"
        required={required}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        aria-autocomplete="list"
        /* Menu bung theo THAO TÁC — bấm, gõ, ↓/↑ — không theo tiêu điểm. Tiêu điểm còn do code
           đặt ở nhiều chỗ (hộp mở, hộp con đóng trả tiêu điểm về, FocusScope kéo về trong hộp);
           bung theo nó thì menu che các ô bên dưới và nuốt phím Esc đầu tiên người dùng bấm. */
        onMouseDown={() => {
          setTouched(true);
          setClosed(false);
        }}
        onChange={(e) => {
          setTouched(true);
          onQuery(e.target.value);
          setClosed(false);
        }}
        onKeyDown={(e) => {
          if (!open) {
            // Bàn phím mở menu bằng ↓/↑ (mẫu combobox của ARIA APG): Tab vào ô không bung.
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setTouched(true);
              setClosed(false);
            }
            return;
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            /*
             * CHỈ NUỐT `Enter` KHI CÓ GÌ ĐÓ ĐỂ CHỌN.
             *
             * Gọi `preventDefault()` vô điều kiện là sai: lọc ra 0 dòng thì
             * `options[active]` là `undefined` — không có gì để chọn, nhưng phím vẫn bị nuốt.
             * Người dùng gõ xong, bấm Enter để lưu phiếu, và KHÔNG CÓ GÌ XẢY RA: form không
             * submit, menu không nói gì. Họ bấm lại, vẫn không gì, rồi kết luận hệ thống treo.
             *
             * Không có dòng nào thì để phím đi tiếp — form submit như mọi ô input khác.
             */
            const option = options[active];
            if (!option) return;
            e.preventDefault();
            choose(option);
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
        data-caret={caret}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onClick={toggle}
      >
        {caret === 'suggest' ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 7h14M5 12h14M5 17h9" />
          </svg>
        ) : (
          <Chevron />
        )}
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
            {pending ? (
              <li className="combo-empty" role="presentation">
                <span>{t('common.loading')}</span>
              </li>
            ) : null}
            {!pending && action ? (
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
            {!failed && !pending && empty && options.length === 0 ? (
              <li className="combo-empty" role="presentation">
                <span>{empty}</span>
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

                `aria-selected={false}`: "đang sáng" KHÔNG phải "đã chọn". Đặt `i === active`
                thì mỗi lần bấm ↓ trình đọc màn hình đọc "đã chọn" cho một dòng
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
