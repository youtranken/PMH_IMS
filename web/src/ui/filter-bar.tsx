import { Children, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Chevron } from '@/ui/chevron';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useMediaQuery } from '@/ui/use-media-query';

/** Bề ngang gập ô lọc — cùng mốc với thẻ gọn của `DataTable`. */
const COLLAPSE_QUERY = BREAKPOINTS.cards;
/** Từ chừng này ô lọc trở lên thì tự gập trên điện thoại (Q-27). */
const AUTO_COLLAPSE_FROM = 3;

/**
 * Thanh lọc dùng chung (AD-15): ô tìm kiếm + các bộ lọc + thao tác bên phải.
 * Mọi danh sách (thiết bị, phần mềm, IP, phiếu…) dùng chung khung này.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder,
  children,
  actions,
  activeCount = 0,
  onClear,
  collapsible,
}: {
  /**
   * ≤600px gập các ô lọc sau nút "Bộ lọc (n)" — ô tìm và nút "Xóa lọc" vẫn ở ngoài. Mặc định tự
   * gập khi có từ `AUTO_COLLAPSE_FROM` ô lọc: 4–6 ô xếp chồng chiếm nửa màn điện thoại trước khi
   * tới dòng dữ liệu đầu tiên. 1–2 ô thì bày ra — gập chúng là thêm một chạm vô ích. Màn không
   * truyền `onClear` (không đếm được bộ lọc đang bật) thì không tự gập: nút "Bộ lọc" trơn che
   * mất việc danh sách đang bị lọc.
   * `false` = không bao giờ gập; `true` = gập dù ít ô.
   */
  collapsible?: boolean;
  /** Số bộ lọc đang bật — có `onClear` và số > 0 thì hiện nút "Xóa lọc (n)" cuối thanh. */
  activeCount?: number;
  onClear?: () => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const narrow = useMediaQuery(COLLAPSE_QUERY);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const showClear = Boolean(onClear) && activeCount > 0;
  const filterCount = Children.toArray(children).length;
  const hasFilters = filterCount > 0;
  const folded =
    (collapsible ?? (Boolean(onClear) && filterCount >= AUTO_COLLAPSE_FROM)) && narrow && hasFilters;
  /*
   * Chỉ có MỘT ô tìm thì bỏ khung thẻ: thẻ viền bọc đúng một ô nhập là hai lớp viền và ~60px
   * chiều cao mất không trên điện thoại. `Children.toArray` bỏ `null`/`false` — bộ lọc ẩn theo
   * tab vẫn tính là "không có".
   */
  const bare = Children.toArray(children).length === 0 && !actions && !showClear;
  return (
    <div className={bare ? 'filter-bar is-bare' : 'filter-bar'}>
      {onSearchChange ? (
        <input
          className="inp search grow"
          type="search"
          value={search ?? ''}
          placeholder={searchPlaceholder ?? t('common.search')}
          aria-label={searchPlaceholder ?? t('common.search')}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      ) : null}
      {folded ? (
        <button
          type="button"
          className="btn filter-toggle"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          {activeCount > 0
            ? t('select.moreFiltersCount', { count: activeCount })
            : t('select.moreFilters')}
          <Chevron direction={open ? 'up' : 'down'} />
        </button>
      ) : null}
      {!folded ? (
        children
      ) : open ? (
        <div id={panelId} className="filter-panel">
          {children}
        </div>
      ) : null}
      {showClear ? (
        <button type="button" className="btn ghost" onClick={onClear}>
          {t('select.clearFilters', { count: activeCount })}
        </button>
      ) : null}
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
