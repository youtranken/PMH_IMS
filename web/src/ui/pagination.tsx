import { useTranslation } from 'react-i18next';

/**
 * Phân trang server-side dùng chung (AD-15) — đi cặp với API `{ items, total }`
 * và query `?page=&limit=`. Không màn nào tự viết nút ‹ › nữa.
 */
export function Pagination({
  page,
  limit,
  total,
  onPageChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const lastPage = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;

  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);

  return (
    <nav className="pager" aria-label={t('common.page')}>
      <span className="pager-info muted">
        {from}–{to} {t('common.of')} {total} {t('common.rows')}
      </span>
      <button
        type="button"
        className="btn sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Trang trước"
      >
        ‹
      </button>
      <span className="pager-page">
        {t('common.page')} {page}/{lastPage}
      </span>
      <button
        type="button"
        className="btn sm"
        disabled={page >= lastPage}
        onClick={() => onPageChange(page + 1)}
        aria-label="Trang sau"
      >
        ›
      </button>
    </nav>
  );
}
