import { useTranslation } from 'react-i18next';
import { Chevron } from './chevron';
import { Select } from './select';

/**
 * Phân trang server-side dùng chung (AD-15) — đi cặp với API `{ items, total }`
 * và query `?page=&limit=`. Không màn nào tự viết nút ‹ › nữa.
 */

/** Số dòng một trang cho người dùng chọn. 10 cho điện thoại, 100 cho lúc soi cả kho. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export function Pagination({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  /**
   * Có truyền → hiện ô chọn số dòng/trang. Không truyền → giữ nguyên như cũ.
   *
   * Cố ý KHÔNG bắt buộc: vài chỗ phân trang trên dữ liệu đã nằm sẵn trong bộ nhớ (danh sách
   * ghế license), đổi `limit` ở đó không có ý nghĩa gì.
   */
  onLimitChange?: (limit: number) => void;
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

      {onLimitChange ? (
        <span className="pager-size">
          <label htmlFor="pager-size">{t('pagination.perPage')}</label>
          <Select
            id="pager-size"
            value={String(limit)}
            ariaLabel={t('pagination.perPage')}
            options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            onChange={(value) => {
              /*
               * Đổi số dòng thì VỀ TRANG 1.
               *
               * Đang ở trang 7 của cỡ 10 rồi đổi sang cỡ 100: trang 7 không còn tồn tại, API
               * trả rỗng và màn hình thành "không có dòng nào" cho một bộ lọc vẫn còn dữ liệu
               * — đúng kiểu hỏng làm người dùng tưởng mất dữ liệu.
               */
              onLimitChange(Number(value));
              onPageChange(1);
            }}
          />
        </span>
      ) : null}

      <button
        type="button"
        className="btn sm pager-nav"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label={t('pagination.prev')}
      >
        <Chevron direction="left" />
      </button>
      <span className="pager-page">
        {t('common.page')} {page}/{lastPage}
      </span>
      <button
        type="button"
        className="btn sm pager-nav"
        disabled={page >= lastPage}
        onClick={() => onPageChange(page + 1)}
        aria-label={t('pagination.next')}
      >
        <Chevron direction="right" />
      </button>
    </nav>
  );
}
