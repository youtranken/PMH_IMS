import { Children, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Chevron } from '@/ui/chevron';
import { useMediaQuery } from '@/ui/use-media-query';

/** Bề ngang gập ô lọc — cùng mốc với thẻ gọn của `DataTable` (`MOBILE_CARD_QUERY`). */
const COLLAPSE_QUERY = '(max-width: 600px)';

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
  collapsible = false,
}: {
  /**
   * ≤600px gập các ô lọc sau nút "Bộ lọc (n)" — ô tìm và nút "Xóa lọc" vẫn ở ngoài. Dành cho
   * thanh nhiều ô (Nhật ký hệ thống): bày hết thì khối lọc cao hơn màn hình đầu tiên.
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
  const hasFilters = Children.toArray(children).length > 0;
  const folded = collapsible && narrow && hasFilters;
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
