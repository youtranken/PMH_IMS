import { Children, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
}: {
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
  const showClear = Boolean(onClear) && activeCount > 0;
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
      {children}
      {showClear ? (
        <button type="button" className="btn ghost" onClick={onClear}>
          {t('select.clearFilters', { count: activeCount })}
        </button>
      ) : null}
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
