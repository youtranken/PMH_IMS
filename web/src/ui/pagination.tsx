import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chevron } from './chevron';
import { Select } from './select';
import { clampPage, lastPageOf, pageWindow } from '@/lib/paging';

/**
 * Phân trang server-side dùng chung (AD-15) — đi cặp với API `{ items, total }`
 * và query `?page=&limit=`. Không màn nào tự viết nút ‹ › nữa.
 */

/** Số dòng một trang cho người dùng chọn. 10 cho điện thoại, 100 cho lúc soi cả kho. */
export const PAGE_SIZES = [10, 20, 50, 100] as const;

export function Pagination({
  page: requestedPage,
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
  const lastPage = lastPageOf(total, limit);
  if (total === 0) return null;
  /* Hiển thị theo trang ĐÃ KẸP: trong nhịp giữa lúc `total` vừa co lại và lúc `useClampPage`
     của màn kịp ghi lại URL, dòng đếm không được phép in ra "41–40 của 40". */
  const page = clampPage(requestedPage, total, limit);

  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  /*
   * Dãy số trang và ô "Tới trang" chỉ bày khi có hơn một trang. Một trang thì chúng chỉ là
   * thêm nút không làm gì — và các bài E2E "đúng bộ nút" của từng màn (thu hẹp còn một dòng)
   * dựa vào việc thanh phân trang khi đó chỉ còn ‹ ›.
   */
  const pages = lastPage > 1 ? pageWindow(page, lastPage) : [];
  // Ô nhập chỉ cần khi dãy số có chỗ bị lược: không lược thì mọi trang đã bấm được thẳng.
  const needsJump = pages.includes('gap');

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
      {pages.length > 0 ? (
        <ol className="pager-pages">
          {pages.map((item, index) =>
            item === 'gap' ? (
              // "…" chỉ là khoảng trống thị giác; trình đọc màn hình đã có "Trang x/y" và ô nhập.
              <li key={`gap-${index}`} className="pager-gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  className={item === page ? 'btn sm pager-num is-current' : 'btn sm pager-num'}
                  aria-label={t('pagination.pageN', { page: item })}
                  aria-current={item === page ? 'page' : undefined}
                  onClick={() => {
                    if (item !== page) onPageChange(item);
                  }}
                >
                  {item}
                </button>
              </li>
            ),
          )}
        </ol>
      ) : null}
      <button
        type="button"
        className="btn sm pager-nav"
        disabled={page >= lastPage}
        onClick={() => onPageChange(page + 1)}
        aria-label={t('pagination.next')}
      >
        <Chevron direction="right" />
      </button>
      {needsJump ? (
        <PageJump lastPage={lastPage} onJump={(target) => onPageChange(target)} />
      ) : null}
    </nav>
  );
}

/**
 * Ô "Tới trang": gõ số rồi Enter (hoặc bấm Đi). Số ngoài khoảng bị kẹp về trang đầu/cuối
 * thay vì báo lỗi — người gõ 999 trên danh sách 20 trang muốn tới trang cuối.
 */
function PageJump({ lastPage, onJump }: { lastPage: number; onJump: (page: number) => void }) {
  const { t } = useTranslation();
  const id = useId();
  const [value, setValue] = useState('');
  return (
    <form
      className="pager-jump"
      // Tự kẹp số ngoài khoảng; để trình duyệt chặn bằng bong bóng "tối đa 20" là bắt người
      // dùng tự sửa một thứ ta sửa được hộ.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const target = Number.parseInt(value, 10);
        if (Number.isNaN(target)) return;
        onJump(Math.min(Math.max(1, target), lastPage));
        setValue('');
      }}
    >
      <label htmlFor={id}>{t('pagination.jumpTo')}</label>
      <input
        id={id}
        className="inp"
        type="number"
        inputMode="numeric"
        min={1}
        max={lastPage}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="btn sm" aria-label={t('pagination.jumpGoLabel')}>
        {t('pagination.jumpGo')}
      </button>
    </form>
  );
}
