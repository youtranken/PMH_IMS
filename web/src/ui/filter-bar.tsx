import type { ReactNode } from 'react';
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
  return (
    <div className="filter-bar">
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
      {onClear && activeCount > 0 ? (
        <button type="button" className="btn ghost" onClick={onClear}>
          {t('select.clearFilters', { count: activeCount })}
        </button>
      ) : null}
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}
