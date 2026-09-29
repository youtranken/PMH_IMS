import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, orDash, todayIso } from '@/lib/format';
import { matchPeriod, periodRange, PERIODS, type Period } from '@/lib/period-range';
import { OWNER_PATH } from '@/lib/routes';
import {
  DISPOSAL_KIND_KEY as KIND_KEY,
  DISPOSAL_KINDS,
  disposalDetail,
  disposalStatusKey,
  type DisposalKind,
} from '@/lib/disposal-kinds';
import { MOBILE_CARD_QUERY, MobileCardList } from '@/ui/data-table';
import { DatePicker } from '@/ui/date-picker';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { useMediaQuery } from '@/ui/use-media-query';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';

interface DisposalItem {
  kind: DisposalKind;
  id: string;
  code: string;
  name: string;
  detail: string | null;
  status: string;
  updatedAt: string | null;
  /** Ngày vào kho theo lịch sử module chủ; hồ sơ nhập thẳng lùi về `updatedAt`. */
  disposedAt: string | null;
  disposedBy: string | null;
  disposedByName: string | null;
  /** Lượt quét tự thanh lý khi quá hạn (Q-13), không phải người bấm. */
  auto: boolean;
  reason: string | null;
}

interface DisposalInventory {
  items: DisposalItem[];
  total: number;
  /** Số hồ sơ mỗi loại trong khoảng ngày/từ khoá đang lọc (bỏ qua chính ô loại). */
  counts: Record<DisposalKind, number>;
  /** Loại có nhiều hồ sơ hơn trần dòng của máy chủ — kho đang thiếu phần của chúng. */
  truncated: DisposalKind[];
}

type Filters = { search: string; kind: string; from: string; to: string };

const EMPTY_FILTERS: Filters = { search: '', kind: '', from: '', to: '' };

/** Ba cách sắp người ta thật sự dùng — chọn trong ô, không bấm tiêu đề cột của bảng tay. */
const SORTS = {
  newest: { key: 'disposedAt', desc: true },
  oldest: { key: 'disposedAt', desc: false },
  code: { key: 'code', desc: false },
} as const;
type SortName = keyof typeof SORTS;

const PERIOD_KEY: Record<Period, string> = {
  month: 'disposal.periodMonth',
  quarter: 'disposal.periodQuarter',
  year: 'disposal.periodYear',
};

/**
 * Đường về hồ sơ gốc — kho thanh lý chỉ NHÌN, sửa thì về đúng module chủ.
 *
 * Dùng `OWNER_PATH` dùng chung chứ không giữ bản riêng: bảng điều khiển cũng dựng link từ một
 * cặp `(loại, id)` y hệt, và hai bản chép tay sẽ lệch nhau khi có loại mới vào kho.
 */
const LINK = OWNER_PATH;

/** Phần lọc (không kèm trang) — dùng CHUNG cho danh sách và nút Xuất Excel (FR-028). */
function filterQuery(filters: Filters, sort: { key: string; desc: boolean }): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  params.set('sort', sort.key);
  params.set('dir', sort.desc ? 'desc' : 'asc');
  return params.toString();
}

/**
 * Kho thanh lý — MỘT chỗ nhìn thấy mọi thứ công ty đã ngừng dùng.
 *
 * Vì sao cần: bốn loại hồ sơ có trạng thái "ngừng dùng" mang tên khác nhau (thiết bị *đã
 * thanh lý*, tài khoản *đã vô hiệu*, đường truyền *thanh lý*…), nằm ở bốn màn khác nhau. Câu "công
 * ty đã bỏ những gì trong quý này, ai quyết" vì thế không ai trả lời được, dù dữ liệu đã có đủ.
 * Màn trả lời bằng khoảng ngày vào kho + cột Người thanh lý, và xuất được ra Excel làm biên bản.
 *
 * Màn này KHÔNG ghi gì. Đưa một hồ sơ vào kho là việc của chính module chủ, dưới đúng cái tên
 * mà module đó dùng — thêm một đường ghi thứ hai ở đây là tạo ra hai nguồn sự thật cho cùng
 * một trạng thái.
 *
 * Lọc, sắp, phân trang chạy ở MÁY CHỦ: lọc ở client chỉ lọc được trang đang xem.
 */
export function DisposalScreen() {
  const { t } = useTranslation();
  /* Bộ lọc nằm trên THANH ĐỊA CHỈ: mở một hồ sơ rồi Back phải về đúng kết quả đang lọc. */
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultSort: SORTS.newest,
    searchKey: 'search',
  });
  const filters: Filters = {
    ...url.filters,
    kind: DISPOSAL_KINDS.includes(url.filters.kind as DisposalKind) ? url.filters.kind : '',
  };
  const kind = filters.kind as '' | DisposalKind;
  const setKind = (value: '' | DisposalKind) => url.setFilter('kind', value);
  const navigate = useNavigate();
  const today = todayIso();
  const period = matchPeriod(filters.from, filters.to, today);
  const sortName: SortName =
    (Object.keys(SORTS) as SortName[]).find(
      (name) => SORTS[name].key === url.sorting.key && SORTS[name].desc === url.sorting.desc,
    ) ?? 'newest';
  const sort = SORTS[sortName];
  const query = filterQuery(filters, sort);

  const inventory = useQuery({
    queryKey: ['disposal', query, url.page, url.limit],
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<DisposalInventory>(
        `/api/v1/disposal?${query}&page=${url.page}&limit=${url.limit}`,
      ),
  });
  useClampPage(url, inventory.data?.total);
  const rows = inventory.data?.items ?? [];
  const truncated = inventory.data?.truncated ?? [];
  const counts = inventory.data?.counts;
  const countAll = counts ? DISPOSAL_KINDS.reduce((sum, key) => sum + counts[key], 0) : 0;

  /* ≤600px: thẻ hai dòng "mã + loại" / "tên", rồi "Đã thanh lý dd/mm · ai" — bảng gập dọc
     lặp nhãn Mã/Loại/Chi tiết/Ngày trên từng thẻ nên cao gấp đôi mà không nói thêm gì. */
  const narrow = useMediaQuery(MOBILE_CARD_QUERY);

  const actionsOf = (item: DisposalItem): RowAction[] => [
    {
      key: 'open',
      label: t('disposal.open'),
      onSelect: () => navigate(LINK[item.kind](item.id)),
    },
    /* Khôi phục đi thẳng tới hộp Khôi phục của module chủ — chỉ phần mềm có hộp đó (Q-13);
       loại khác đổi trạng thái trong Sửa hồ sơ. */
    ...(item.kind === 'software'
      ? [
          {
            key: 'restore',
            label: t('software.restore'),
            onSelect: () => navigate(`${LINK.software(item.id)}?restore=1`),
          },
        ]
      : []),
  ];

  const setPeriod = (next: Period | '') => {
    const range = next ? periodRange(next, today) : { from: '', to: '' };
    url.setFilter('from', range.from);
    url.setFilter('to', range.to);
  };

  return (
    <>
      <PageHeader
        title={t('disposal.title')}
        subtitle={t('disposal.subtitle')}
        actions={
          <ExportXlsxButton url={`/api/v1/disposal/export.xlsx?${query}`} fileName="kho-thanh-ly.xlsx" />
        }
      />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('disposal.search')}
        activeCount={url.activeCount}
        onClear={url.clearFilters}
      >
        <div className="segmented" role="group" aria-label={t('disposal.filterKind')}>
          <button type="button" aria-pressed={kind === ''} onClick={() => setKind('')}>
            {/* Số đi kèm nhãn lọc phải NHẠT và NHỎ hơn chữ nhãn (`.seg-count`, dùng chung với
                màn Dải mạng): để cùng cỡ cùng đậm thì mắt đọc "Tất cả 12" thành hai từ ngang
                hàng chứ không phải một nhãn kèm một con số. */}
            {t('disposal.allKinds')} <span className="seg-count">{countAll}</span>
          </button>
          {(Object.keys(KIND_KEY) as DisposalKind[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={kind === key}
              onClick={() => setKind(key)}
            >
              {t(KIND_KEY[key])} <span className="seg-count">{counts?.[key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label={t('disposal.period')}>
          {PERIODS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={period === key}
              onClick={() => setPeriod(period === key ? '' : key)}
            >
              {t(PERIOD_KEY[key])}
            </button>
          ))}
        </div>
        <DatePicker
          value={filters.from}
          ariaLabel={t('disposal.from')}
          placeholder={t('disposal.from')}
          max={filters.to || undefined}
          onChange={(value) => url.setFilter('from', value)}
        />
        <DatePicker
          value={filters.to}
          ariaLabel={t('disposal.to')}
          placeholder={t('disposal.to')}
          min={filters.from || undefined}
          onChange={(value) => url.setFilter('to', value)}
        />
        <Select
          value={sortName}
          ariaLabel={t('disposal.sort')}
          options={(Object.keys(SORTS) as SortName[]).map((name) => ({
            value: name,
            label: t(`disposal.sort_${name}`),
          }))}
          onChange={(value) => url.setSorting({ ...SORTS[value as SortName] })}
        />
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
         * "KHO ĐANG TRỐNG" ≠ "BỘ LỌC KHÔNG RA GÌ": gõ một từ khóa không khớp mà màn tuyên bố
         * kho rỗng thì người đọc tin rằng chưa ai thanh lý thứ gì. Mỗi vế dẫn tới một việc khác
         * nhau: một bên là bỏ bớt lọc, bên kia là không có gì để làm cả.
         */
        !url.isFiltered ? (
          <EmptyState title={t('disposal.empty')} hint={t('disposal.emptyHint')} />
        ) : (
          <EmptyState
            title={t('disposal.noHit')}
            hint={t('disposal.noHitHint')}
            action={
              <button type="button" className="btn sm" onClick={url.clearFilters}>
                {t('disposal.clearFilters')}
              </button>
            }
          />
        )
      ) : (
        <>
          {narrow ? (
            <MobileCardList
              rows={rows}
              rowKey={(item) => `${item.kind}-${item.id}`}
              card={{
                title: (item) => item.code,
                href: (item) => LINK[item.kind](item.id),
                badge: (item) => <span className="badge muted">{t(KIND_KEY[item.kind])}</span>,
                actions: (item) => (
                  <RowActions
                    label={t('common.actionsOf', { subject: item.code })}
                    items={actionsOf(item)}
                  />
                ),
                subtitle: (item) => item.name,
                meta: (item) =>
                  [
                    `${statusLabel(item.status, t)} ${orDash(formatDate(item.disposedAt))}`,
                    byText(item, t),
                  ]
                    .filter(Boolean)
                    .join(' · '),
              }}
            />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>{t('disposal.code')}</th>
                    <th>{t('disposal.kind')}</th>
                    <th>{t('disposal.detail')}</th>
                    <th>{t('disposal.at')}</th>
                    <th>{t('disposal.by')}</th>
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
                        <span>{t(KIND_KEY[item.kind])}</span>
                        {/* Tên gốc của trạng thái theo module chủ — thứ cả màn này sinh ra để nói. */}
                        <span className="cell-sub">
                          <span className="badge muted">{statusLabel(item.status, t)}</span>
                        </span>
                      </td>
                      <td data-label={t('disposal.detail')}>
                        {disposalDetail(item.kind, item.detail, t)}
                      </td>
                      <td data-label={t('disposal.at')}>
                        {orDash(formatDate(item.disposedAt))}
                      </td>
                      <td data-label={t('disposal.by')}>
                        {orDash(byText(item, t))}
                        {item.reason ? <span className="cell-sub">{item.reason}</span> : null}
                      </td>
                      <td className="col-center col-sticky-end" data-label={t('common.actions')}>
                        <div className="action-cell">
                          <RowActions
                            label={t('common.actionsOf', { subject: item.code })}
                            items={actionsOf(item)}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            page={url.page}
            limit={url.limit}
            total={inventory.data?.total ?? 0}
            onPageChange={url.setPage}
            onLimitChange={url.setLimit}
          />
        </>
      )}
    </>
  );
}

/** Trạng thái lạ in nguyên văn — luật đặt tên nằm ở `disposalStatusKey`. */
function statusLabel(status: string, t: (key: string) => string): string {
  const key = disposalStatusKey(status);
  return key ? t(key) : status;
}

/**
 * "Hệ thống · quá hạn" cho lượt tự thanh lý (Q-13) — không thì hồ sơ tự bỏ trông y hệt hồ sơ
 * có người bấm. Người đã nghỉ (không còn tài khoản) thì in email, vẫn tra được.
 */
function byText(item: DisposalItem, t: (key: string) => string): string {
  if (item.auto) return t('disposal.bySystem');
  return item.disposedByName ?? item.disposedBy ?? '';
}
