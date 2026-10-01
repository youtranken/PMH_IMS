import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Chevron } from '@/ui/chevron';
import { useAnchoredMenu } from '@/ui/use-anchored-menu';
import { useDialogPortal } from '@/ui/dialog';
import { foldSearch } from '@/lib/search-fold';

export interface SelectOption {
  value: string;
  label: ReactNode;
  /**
   * Nhãn gọn hiện trên NÚT khi mục này đang chọn (vd chỉ mã site), trong khi menu vẫn hiện
   * `label` đầy đủ ("mã — tên"). Người chưa thuộc mã cần tên để chọn; chọn xong thì mã là đủ.
   */
  short?: ReactNode;
  /** Chữ để ô lọc so khớp khi `label` không phải chuỗi thuần. */
  searchText?: string;
  /**
   * Tên nhóm (vd mã site của tủ). Các mục liền nhau cùng nhóm được vẽ dưới một tiêu đề, nên
   * `label` chỉ cần phần phân biệt trong nhóm. Nơi gọi tự sắp theo nhóm; mục không có nhóm
   * đứng riêng (vd "Tất cả tủ").
   */
  group?: string;
}

interface GroupRun {
  group: string | undefined;
  items: { option: SelectOption; index: number }[];
}

/** Cắt mảng phẳng thành các đoạn liền nhau cùng `group`, giữ chỉ mục gốc cho ↑/↓. */
function groupRuns(options: SelectOption[]): GroupRun[] {
  const runs: GroupRun[] = [];
  options.forEach((option, index) => {
    const last = runs[runs.length - 1];
    if (last && last.group === option.group) last.items.push({ option, index });
    else runs.push({ group: option.group, items: [{ option, index }] });
  });
  return runs;
}

/** Quá ngần này lựa chọn thì menu tự có ô gõ để lọc — dò bằng mắt bắt đầu chậm từ đây. */
const SEARCH_THRESHOLD = 8;

function optionText(option: SelectOption): string {
  if (option.searchText !== undefined) return option.searchText;
  return typeof option.label === 'string' || typeof option.label === 'number'
    ? String(option.label)
    : '';
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
  required,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  searchable,
  indicateFilled = true,
}: {
  /** Ô đang báo lỗi — `Field error` tự truyền; viền đỏ và tiêu điểm của `useFormErrors` bám vào đây. */
  'aria-invalid'?: boolean;
  /**
   * Gắn lên chính nút mở menu, để `<Field htmlFor>` còn trỏ vào một điều khiển CÓ THẬT.
   *
   * Cần khi một ô đổi qua lại giữa `<input>` và `Select` tùy trạng thái (ô "IP trong" của
   * form NAT): nhánh nào thiếu `id` thì bấm vào nhãn không xảy ra gì, và `getByLabel` của
   * bài kiểm cũng không tìm ra ô.
   */
  id?: string;
  /**
   * Nối `hint`/`error` của `Field` vào chính nút mở menu.
   *
   * `Field` tự truyền — nơi gọi không phải biết. Thiếu nó thì dòng "tối thiểu 12 ký tự…" chỉ
   * là chữ nằm cạnh ô, trình đọc màn hình không biết nó thuộc về ô nào.
   */
  'aria-describedby'?: string;
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
  /**
   * Ô BẮT BUỘC — đặt `aria-required` lên nút mở menu.
   *
   * ===== VÌ SAO CẦN, VÀ VÌ SAO CHỈ CÓ THẾ =====
   *
   * `Field required` chỉ VẼ dấu `*` (`page-header.tsx`), còn việc chặn thật thì tuỳ loại điều
   * khiển: `<input>` có `required` của trình duyệt, còn `Select` render ra `<button>` nên
   * KHÔNG có gì cả. Thiếu cờ này thì ô đội dấu `*` mà trình đọc màn hình không nghe thấy chữ
   * "bắt buộc" nào — dấu ấy là thứ chỉ người sáng mắt đọc được.
   *
   * Cờ này lo đúng phần đó. Nó KHÔNG dựng thêm hàng rào chặn submit, và cố ý: các form ấy đã
   * tự kiểm trong `submit()` rồi báo bằng một câu tiếng Việt đọc được ("Cần ít nhất: mã thiết
   * bị, tên và loại thiết bị.") — tốt hơn bong bóng mặc định của trình duyệt. Nhồi thêm một
   * `<input required>` ẩn để ép trình duyệt chặn là dựng hàng rào THỨ HAI cho cùng một luật,
   * và hai hàng rào cho một luật thì sớm muộn nói khác nhau.
   */
  required?: boolean;
  /** Ô gõ để lọc trong menu. Mặc định tự bật khi có hơn 8 lựa chọn. */
  searchable?: boolean;
  /**
   * `false` = không gắn `data-filled` dù đang có giá trị. Cho ô KHÔNG phải bộ lọc nằm trong thanh
   * lọc (ô sắp xếp): nó luôn có giá trị, tô lên thì thanh lọc báo "đang lọc" khi chẳng lọc gì.
   */
  indicateFilled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const portal = useDialogPortal();

  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected ? (selected.short ?? selected.label) : (placeholder ?? '—');
  /* Chữ đầy đủ cho `title`: nút và dòng menu cắt "…" khi hẹp, rê chuột vẫn đọc được hết.
     Lấy theo `label` đầy đủ (không theo `short`) để nút chỉ in mã vẫn cho xem tên. */
  const selectedTitle = selected ? optionText(selected) || undefined : undefined;

  const canSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const folded = foldSearch(query.trim());
  const shown =
    canSearch && folded
      ? options.filter((o) => foldSearch(optionText(o)).includes(folded))
      : options;

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

  /* `min`: menu ít nhất bằng nút, được nới theo nội dung (có trần). Rộng đúng bằng nút thì
     "E2E-HCM · TU-E2E-…" cắt ngay giữa mã, hai tủ đọc ra như một. */
  const { refs, floatingStyles } = useAnchoredMenu(open, {
    matchWidth: 'min',
    maxHeight: 288,
  });

  /*
   * Mở → active = option đang chọn. PHỤ THUỘC VÀO MỘT SỐ, KHÔNG VÀO MẢNG.
   *
   * `options` gần như KHÔNG BAO GIỜ ổn định về identity ở nơi gọi thật (`lists.data?.x ?? []`,
   * `.filter().map()`), nên nghe cả mảng thì mỗi lượt cha render lại KÉO DÒNG SÁNG VỀ option
   * đang chọn trong khi menu vẫn đang mở: bấm ↓ ba lần, một query anh em trả về, Enter chọn
   * nhầm. Chỉ mục của option đang chọn là một số, ổn định theo giá trị. Cùng luật với
   * `Combobox`.
   */
  const selectedIndex = shown.findIndex((o) => o.value === value);
  useEffect(() => {
    if (!open) return;
    setActive(selectedIndex < 0 ? 0 : selectedIndex);
  }, [open, selectedIndex, folded]);

  // Đóng menu thì bỏ chữ lọc: mở lại mà vẫn thấy danh sách bị lọc dở là tưởng mất lựa chọn.
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  /* Có ô lọc thì đưa tiêu điểm vào đó — nhưng chỉ với chuột/bàn phím. Trên điện thoại, focus
     tự động bật bàn phím ảo che nửa danh sách trong khi người dùng chỉ định chạm chọn. */
  useEffect(() => {
    if (!open || !canSearch) return;
    if (typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches)
      return;
    searchRef.current?.focus();
  }, [open, canSearch]);

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

  /* Một bộ phím cho cả nút mở lẫn ô lọc: tiêu điểm ở đâu thì ↑/↓/Enter/Esc vẫn làm cùng một
     việc, không có chuyện gõ lọc xong phải Tab ngược về nút mới chọn được. */
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) =>
        e.key === 'ArrowDown' ? Math.min(i + 1, shown.length - 1) : Math.max(i - 1, 0),
      );
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const o = shown[active];
      if (o) choose(o.value);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const activeId = open && shown[active] ? optionId(active) : undefined;

  const list = (
    <ul
      className={canSearch ? 'fsel-list' : 'fsel-menu'}
      id={listId}
      role="listbox"
      style={canSearch ? undefined : floatingStyles}
      ref={canSearch ? undefined : refs.setFloating}
    >
      {/* HỎNG được ưu tiên hơn RỖNG: khi không hỏi được thì "không có lựa chọn" là một câu
          khẳng định mà ta không có quyền nói. `role="alert"`, không `role="option"` — trình
          đọc màn hình phải đọc nó như cảnh báo, và ↓/Enter không chạm tới được. */}
      {failed ? (
        <li className="fsel-error" role="presentation">
          <span role="alert">{t('common.optionsLoadError')}</span>
        </li>
      ) : shown.length === 0 ? (
        <li className="fsel-none" role="presentation">
          {t('select.noOptions')}
        </li>
      ) : null}
      {/*
          `<li role="presentation">`: `<ul role="listbox">` chỉ được chứa `option`; `<li>` trần
          chen một tầng `listitem` vào giữa.

          `tabIndex={-1}`: mẫu `aria-activedescendant` đòi tiêu điểm DOM ở NGUYÊN trên nút mở
          (hoặc ô lọc). Menu portal vào điểm neo của `dialog.tsx` — con CUỐI của `RD.Content`,
          sau cả `.sheet-footer` — nên option nhận Tab thì tiêu điểm rơi xuống SAU nút Lưu.
      */}
      {groupRuns(shown).map((run) => {
        const items = run.items.map(({ option: o, index: i }) => (
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
              <span className="fsel-opt-label" title={optionText(o) || undefined}>
                {o.label}
              </span>
            </button>
          </li>
        ));
        if (run.group === undefined) return items;
        const headId = `${listId}-g${run.items[0].index}`;
        /* Tiêu đề nhóm không phải `option`: ↑/↓ chạy trên mảng phẳng `shown`, nên nó không
           bao giờ thành dòng sáng và Enter không gán được tên nhóm vào form. */
        return (
          <li key={headId} role="group" aria-labelledby={headId}>
            <div className="fsel-group" id={headId} role="presentation">
              {run.group}
            </div>
            <ul role="presentation" className="fsel-group-list">
              {items}
            </ul>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div
      className={`fsel${className ? ` ${className}` : ''}`}
      ref={refs.setReference}
    >
      <button
        ref={triggerRef}
        id={id}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        type="button"
        className="fsel-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-required={required ? true : undefined}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        /* Thanh lọc tô ô đang mang giá trị (`.filter-bar .fsel-trigger[data-filled]`): chữ
           trên nút đổi mà khung y nguyên thì không ai nhận ra danh sách đang bị lọc. */
        data-filled={indicateFilled && value !== '' ? 'true' : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
      >
        <span className={selected ? 'fsel-val' : 'fsel-val ph'} title={selectedTitle}>
          {label}
        </span>
        <Chevron className="fsel-caret" />
      </button>
      {open &&
        createPortal(
          canSearch ? (
            /* Ô lọc nằm NGOÀI `listbox`: listbox chỉ được chứa option, nhét ô nhập vào trong
               là cây trợ năng sai. */
            <div className="fsel-menu fsel-pop" style={floatingStyles} ref={refs.setFloating}>
              <input
                ref={searchRef}
                type="search"
                className="fsel-search"
                value={query}
                placeholder={t('select.filterPlaceholder')}
                aria-label={t('select.filterOf', { label: ariaLabel ?? '' })}
                aria-controls={listId}
                aria-activedescendant={activeId}
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
              />
              {list}
            </div>
          ) : (
            list
          ),
          portal ?? document.body,
        )}
    </div>
  );
}
