import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, orDash } from '@/lib/format';
import { OWNER_PATH } from '@/lib/routes';
import {
  DISPOSAL_KIND_KEY as KIND_KEY,
  DISPOSAL_KINDS,
  disposalDetail,
  disposalStatusKey,
  type DisposalKind,
} from '@/lib/disposal-kinds';
import { RowActions } from '@/ui/row-actions';
import { useListUrlState } from '@/ui/use-list-url-state';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { foldSearch } from '@/lib/search-fold';

interface DisposalItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  detail: string | null;
  status: string;
  updatedAt: string | null;
}

interface DisposalInventory {
  items: DisposalItem[];
  /** Loại có nhiều hồ sơ hơn trần dòng của máy chủ — `items` đang thiếu phần của chúng. */
  truncated: DisposalKind[];
}

/**
 * Đường về hồ sơ gốc — kho thanh lý chỉ NHÌN, sửa thì về đúng module chủ.
 *
 * Dùng `OWNER_PATH` dùng chung chứ không giữ bản riêng: bảng điều khiển cũng dựng link từ một
 * cặp `(loại, id)` y hệt, và hai bản chép tay sẽ lệch nhau khi có loại mới vào kho.
 */
const LINK = OWNER_PATH;

/**
 * Kho thanh lý — MỘT chỗ nhìn thấy mọi thứ công ty đã ngừng dùng.
 *
 * Vì sao cần: bốn loại hồ sơ có trạng thái "ngừng dùng" mang tên khác nhau (thiết bị *đã
 * thanh lý*, tài khoản *đã vô hiệu*, đường truyền *thanh lý*…), nằm ở bốn màn khác nhau. Câu "công
 * ty đã bỏ những gì trong quý này" vì thế không ai trả lời được, dù dữ liệu đã có đủ từ lâu.
 *
 * Màn này KHÔNG ghi gì. Đưa một hồ sơ vào kho là việc của chính module chủ, dưới đúng cái tên
 * mà module đó dùng — thêm một đường ghi thứ hai ở đây là tạo ra hai nguồn sự thật cho cùng
 * một trạng thái.
 *
 * Chuyện "không tính hạn, không vào email digest" thì các module đã lo sẵn: mọi nguồn hạn lọc
 * `status <> retired` ngay trong truy vấn của mình.
 */
export function DisposalScreen() {
  const { t } = useTranslation();
  /* Bộ lọc nằm trên THANH ĐỊA CHỈ: mở một hồ sơ rồi Back phải về đúng kết quả đang lọc. */
  const url = useListUrlState<{ search: string; kind: string }>({
    emptyFilters: { search: '', kind: '' },
    searchKey: 'search',
  });
  const search = url.filters.search;
  const kind: '' | DisposalKind = DISPOSAL_KINDS.includes(url.filters.kind as DisposalKind)
    ? (url.filters.kind as DisposalKind)
    : '';
  const setKind = (value: '' | DisposalKind) => url.setFilter('kind', value);
  const navigate = useNavigate();
  const clearFilters = () => {
    url.setSearchInput('');
    url.setFilter('kind', '');
  };

  const inventory = useQuery({
    queryKey: ['disposal'],
    queryFn: () => apiFetch<DisposalInventory>('/api/v1/disposal'),
  });
  const all = useMemo(() => inventory.data?.items ?? [], [inventory.data]);
  const truncated = inventory.data?.truncated ?? [];

  const rows = useMemo(() => {
    // Gấp dấu CẢ HAI VẾ (B-01): gõ `may tram` phải ra `Máy trạm`, và gõ `Máy trạm` cũng vẫn
    // phải ra. Gấp một vế thôi là chữa bệnh này rồi mắc bệnh ngược lại.
    const term = foldSearch(search.trim());
    return all.filter((item) => {
      if (kind && item.kind !== kind) return false;
      if (!term) return true;
      return (
        foldSearch(item.code).includes(term) ||
        foldSearch(item.name).includes(term)
      );
    });
  }, [all, search, kind]);

  /* Đếm theo loại trên TOÀN BỘ, không theo tập đang lọc: nút lọc mà mang con số của chính
     tập đã lọc thì bấm vào đâu cũng thấy "đúng", và nó hết là bộ đếm. */
  const countOf = (target: DisposalKind) =>
    all.filter((item) => item.kind === target).length;

  return (
    <>
      <PageHeader title={t('disposal.title')} subtitle={t('disposal.subtitle')} />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('disposal.search')}
      >
        <div className="segmented" role="group" aria-label={t('disposal.filterKind')}>
          <button
            type="button"
            className={kind === '' ? 'on' : undefined}
            aria-pressed={kind === ''}
            onClick={() => setKind('')}
          >
            {/* Số đi kèm nhãn lọc phải NHẠT và NHỎ hơn chữ nhãn (`.seg-count`, dùng chung với
                màn Dải mạng): để cùng cỡ cùng đậm thì mắt đọc "Tất cả 12" thành hai từ ngang
                hàng chứ không phải một nhãn kèm một con số. */}
            {t('disposal.allKinds')} <span className="seg-count">{all.length}</span>
          </button>
          {(Object.keys(KIND_KEY) as DisposalKind[]).map((key) => (
            <button
              key={key}
              type="button"
              className={kind === key ? 'on' : undefined}
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
            >
              {t(KIND_KEY[key])} <span className="seg-count">{countOf(key)}</span>
            </button>
          ))}
        </div>
      </FilterBar>

      <p className="alert info">{t('disposal.note')}</p>
      {truncated.length > 0 ? (
        <p className="alert">
          {t('disposal.truncated', {
            kinds: truncated.map((key) => t(KIND_KEY[key])).join(', '),
          })}
        </p>
      ) : null}

      {inventory.isLoading ? (
        <Loading />
      ) : inventory.isError ? (
        <LoadError error={inventory.error} onRetry={() => void inventory.refetch()} />
      ) : rows.length === 0 ? (
        /*
         * "KHO ĐANG TRỐNG" ≠ "BỘ LỌC KHÔNG RA GÌ" — và bản cũ nói cả hai bằng một câu.
         *
         * `rows` là danh sách SAU lọc, nên gõ một từ khóa không khớp là màn tuyên bố kho rỗng.
         * Người đọc tin rằng chưa ai thanh lý thứ gì, trong khi có thể đang có vài chục hồ sơ
         * nằm đó — chỉ là không khớp chữ vừa gõ. Hỏi `all` (TRƯỚC lọc) mới phân biệt
         * được, và mỗi vế dẫn tới một việc khác nhau: một bên là bỏ bớt lọc, bên kia là
         * không có gì để làm cả.
         */
        all.length === 0 ? (
          <EmptyState title={t('disposal.empty')} hint={t('disposal.emptyHint')} />
        ) : (
          <EmptyState
            title={t('disposal.noHit')}
            hint={t('disposal.noHitHint')}
            action={
              <button type="button" className="btn sm" onClick={clearFilters}>
                {t('disposal.clearFilters')}
              </button>
            }
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('disposal.code')}</th>
                <th>{t('disposal.kind')}</th>
                <th>{t('disposal.detail')}</th>
                <th>{t('disposal.at')}</th>
                <th className="col-center col-sticky-end">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={`${item.kind}-${item.id}`}>
                  <td data-label={t('disposal.code')}>
                    {/* Vẫn mở được hồ sơ gốc: "đã thanh lý" không phải "đã xoá", và người ta
                        mở nó ra chính để đọc lịch sử vì sao bỏ. */}
                    <Link className="mono" to={LINK[item.kind](item.id)}>
                      {item.code}
                    </Link>
                    <span className="cell-sub">{item.name}</span>
                  </td>
                  <td data-label={t('disposal.kind')}>
                    {/* Chữ thường thẳng mép với dòng trạng thái bên dưới; trạng thái mới là badge. */}
                    <span>{t(KIND_KEY[item.kind])}</span>
                    {/*
                      TÊN GỐC CỦA TRẠNG THÁI — thứ cả màn này sinh ra để nói (17/09/2026).
                      `status` được API trả về từ đầu và giữ nguyên tên của module chủ ("đã
                      thanh lý" / "đã bỏ" / "đã vô hiệu"), nhưng bảng chưa bao giờ in nó ra.
                      Thành thử màn dựng lên vì "ba trạng thái mang ba cái tên khác nhau" lại
                      là màn duy nhất không cho biết hồ sơ này mang cái tên nào.
                    */}
                    <span className="cell-sub">
                      <span className="badge muted">{statusLabel(item.status, t)}</span>
                    </span>
                  </td>
                  <td data-label={t('disposal.detail')}>
                    {disposalDetail(item.kind, item.detail, t)}
                  </td>
                  <td data-label={t('disposal.at')}>{orDash(formatDate(item.updatedAt))}</td>
                  <td className="col-center col-sticky-end" data-label={t('common.actions')}>
                    <div className="action-cell">
                      <RowActions
                        label={t('common.actionsOf', { subject: item.code })}
                        items={[
                          {
                            key: 'open',
                            label: t('disposal.open'),
                            onSelect: () => navigate(LINK[item.kind](item.id)),
                          },
                          /* Khôi phục đi thẳng tới hộp Khôi phục của module chủ — chỉ phần
                             mềm có hộp đó (Q-13); loại khác đổi trạng thái trong Sửa hồ sơ. */
                          ...(item.kind === 'software'
                            ? [
                                {
                                  key: 'restore',
                                  label: t('software.restore'),
                                  onSelect: () =>
                                    navigate(`${LINK.software(item.id)}?restore=1`),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Trạng thái lạ in nguyên văn — luật đặt tên nằm ở `disposalStatusKey`. */
function statusLabel(status: string, t: (key: string) => string): string {
  const key = disposalStatusKey(status);
  return key ? t(key) : status;
}
