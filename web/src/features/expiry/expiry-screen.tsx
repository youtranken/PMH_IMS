import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Chevron } from '@/ui/chevron';
import { apiFetch } from '@/lib/api-client';
import { useExpiryKinds } from '@/lib/expiry-kinds';
import { daysUntil } from '@/lib/expiry';
import { formatDate, formatDateTime, orDash, todayIso } from '@/lib/format';
import { daysBetweenIso, periodRange } from '@/lib/period-range';
import type { Me } from '@/lib/me';
import { renewPreset } from '@/lib/renew-dates';
import { PATHS } from '@/lib/routes';
import { useApiMutation } from '@/lib/api';
import { DataTable, type TableGroupBy } from '@/ui/data-table';
import { DatePicker } from '@/ui/date-picker';
import { Pagination } from '@/ui/pagination';
import { ChipToggleGroup } from '@/ui/chip-toggle-group';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { KpiStrip, KpiTile } from '@/ui/kpi-strip';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { useExpiryThresholds } from '@/ui/use-expiry-thresholds';
import { Select } from '@/ui/select';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { RenewDialog } from '@/ui/renew-dialog';
import { useConfirm } from '@/ui/confirm-provider';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { DigestRulesPanel } from './digest-rules-panel';

interface ExpiryRow {
  id: string;
  label: string;
  /** Mã và tên tách riêng (nguồn nào có) — mã in mono cạnh tên thường như mọi bảng khác. */
  code?: string;
  name?: string;
  /** Q-13: ngày hệ thống sẽ tự Thanh lý mục phần mềm đã Hết hạn. */
  autoRetireOn?: string | null;
  sublabel: string | null;
  kind: string;
  start: string | null;
  end: string;
  link: string;
  daysLeft: number;
  canRenew: boolean;
  /** Nguồn có sổ gia hạn: hộp Gia hạn hiện ô hợp đồng + chi phí (Q-15). */
  canRenewTerms?: boolean;
}

/** Một lượt gia hạn đã ghi (`renewal_history`) — tab "Đã gia hạn". */
interface RenewalRow {
  id: string;
  objectKind: string;
  objectId: string;
  label: string;
  oldEnd: string | null;
  newEnd: string;
  actor: string;
  /** Họ tên người gia hạn — API tra; vắng thì hiện email. */
  actorName?: string | null;
  createdAt: string;
}

/** Tham số khoảng ngày của tab "Đã gia hạn" — tên khoá theo `RenewalsQueryDto` bên API. */
export function renewalsQuery(range: { from: string; to: string }): string {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  return params.toString();
}

interface ExpiryResponse {
  /** MỘT TRANG — không phải trọn bộ cửa sổ. */
  items: ExpiryRow[];
  /** Tổng số mục khớp bộ lọc — CẢ KHO, để `Pagination` biết có bao nhiêu trang. */
  total: number;
  /** `autoRetire`: mục phần mềm đã Hết hạn đang chờ tự Thanh lý (Q-13). */
  summary: { expired: number; critical: number; warning: number; autoRetire?: number };
  /*
   * `expiry.service.ts:129` trả KÈM ngưỡng đã dùng để đếm `summary`. Bỏ sót trường này thì màn
   * phải hỏi lại `/expiry/thresholds` — một truy vấn THỨ HAI, có `retry: false`, và khi nó hỏng
   * thì lùi về 7/30 cứng.
   *
   * Hậu quả: ô số đếm bằng ngưỡng của server, bảng lọc bằng ngưỡng của truy vấn kia. Admin đặt
   * `expiry.critical_days = 14` rồi `/expiry/thresholds` lỗi một lượt → ô "Gấp" ghi 6, bấm vào
   * bảng còn 3 dòng, ba dòng kia lặng lẽ chạy sang nhóm "Sắp tới". Hai con số mâu thuẫn trên
   * cùng một màn hình, và không bài kiểm nào bắt được vì mỗi bên tự nhất quán với chính nó.
   */
  thresholds: { criticalDays: number; warningDays: number };
  /**
   * Nguồn hạn đã LỖI trong lượt này — `items`, `total` và `summary` thiếu phần của chúng.
   * Màn phải nói ra (EX-002), không thì con số thiếu đọc y như con số đủ.
   */
  failedKinds?: string[];
}

/** Cửa sổ nhìn tới — mấy mốc người ta thật sự dùng, không cho gõ số tùy ý cho rối. */
const WINDOWS = [7, 30, 60, 90, 180, 365];

/**
 * Cửa sổ theo LỊCH ("tới hết tháng này / quý này / tới ngày…") cho câu hỏi ngân sách: "tháng
 * này có gì hết hạn". Quy về `withinDays` của API (1–365), vẫn luôn kèm mục đã quá hạn.
 */
const PERIOD_WINDOWS = ['month', 'quarter', 'custom'] as const;
type PeriodWindow = (typeof PERIOD_WINDOWS)[number];

/** Cột bấm sắp được — tên khớp `EXPIRY_SORTS` bên API. */
const SORTABLE = ['label', 'kind', 'end'] as const;

/** Số ngày từ hôm nay tới `end` (tính cả hai đầu), kẹp vào 1–365 như API. */
function windowUntil(end: string, today: string): number {
  return Math.min(365, Math.max(1, daysBetweenIso(today, end)));
}

/**
 * Màn Expiry tổng hợp (FR-012).
 *
 * Mọi thứ có ngày hết hạn của cả hệ thống về một chỗ: bảo hành thiết bị, license, SSL,
 * tên miền, hợp đồng bảo trì, hợp đồng đường truyền. Danh sách LOẠI lấy từ API — module
 * nào đăng ký nguồn thì tự xuất hiện, màn này không viết cứng tên loại nào (AD-7).
 */
export function ExpiryScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const askConfirm = useConfirm();
  const [renewing, setRenewing] = useState<ExpiryRow | null>(null);
  const [tab, setTab] = useState('list');
  const [addingRule, setAddingRule] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const canEditRules = me.role === 'sa' || me.role === 'admin';

  /*
   * BA BỘ LỌC SỐNG TRÊN THANH ĐỊA CHỈ, KHÔNG TRONG `useState`.
   *
   * `docs/SHARED-REGISTRY.md` viết thẳng về `useListUrlState`: "Cấm quay lại `useState` cho
   * bốn thứ đó — mất bộ lọc khi F5, không gửi được link, và bấm Back từ trang chi tiết rơi về
   * một danh sách trắng".
   *
   * `withinDays` để dạng chuỗi trong URL rồi mới `Number()`: hook giữ mọi bộ lọc là chuỗi, và
   * một link ai đó sửa tay (`?withinDays=abc`) phải rơi về mặc định chứ không thành `NaN` đi
   * thẳng vào `queryKey`.
   */
  const url = useListUrlState<{
    withinDays: string;
    kinds: string;
    state: string;
    period: string;
    until: string;
  }>({
    emptyFilters: { withinDays: '', kinds: '', state: '', period: '', until: '' },
    defaultSort: { key: 'end', desc: false },
  });
  const today = todayIso();
  const period = (PERIOD_WINDOWS as readonly string[]).includes(url.filters.period)
    ? (url.filters.period as PeriodWindow)
    : '';
  const until =
    period === 'custom'
      ? url.filters.until || ''
      : period
        ? periodRange(period, today).to
        : '';
  const withinDays = until
    ? windowUntil(until, today)
    : WINDOWS.includes(Number(url.filters.withinDays))
      ? Number(url.filters.withinDays)
      : 30;
  const sortKey = (SORTABLE as readonly string[]).includes(url.sorting.key) ? url.sorting.key : 'end';
  const sorting: SortingState = [{ id: sortKey, desc: url.sorting.desc }];
  const sortParams = `&sort=${sortKey}&dir=${url.sorting.desc ? 'desc' : 'asc'}`;
  const kind = url.filters.kinds;
  /** Ô số nào đang được bấm để lọc. Rỗng = xem tất cả. Lọc ở SERVER — xem chú thích dưới. */
  const state = (['expired', 'critical', 'warning', 'autoRetire'] as const).includes(
    url.filters.state as 'expired',
  )
    ? (url.filters.state as 'expired' | 'critical' | 'warning' | 'autoRetire')
    : '';
  /* Ô "Khoảng thời gian" nhận cả số ngày lẫn mốc lịch; chọn một bên thì gỡ bên kia. */
  const setWindow = (value: string) => {
    if ((PERIOD_WINDOWS as readonly string[]).includes(value)) {
      url.setFilter('withinDays', '');
      url.setFilter('period', value);
      if (value !== 'custom') url.setFilter('until', '');
    } else {
      url.setFilter('period', '');
      url.setFilter('until', '');
      url.setFilter('withinDays', value);
    }
  };
  const setKind = (value: string) => url.setFilter('kinds', value);
  const setState = (value: '' | 'expired' | 'critical' | 'warning' | 'autoRetire') =>
    url.setFilter('state', value);

  /*
   * `useExpiryThresholds()` chỉ là NGUỒN DỰ PHÒNG của màn này.
   *
   * Mọi thứ trên màn — phép lọc bảng, nhãn ô số, VÀ huy hiệu ở cột Trạng thái — đọc `nguong`
   * bên dưới, tức ngưỡng đi KÈM chính lượt trả về, vì đó mới đúng là bộ ngưỡng mà `summary` đã
   * dùng để đếm. Để một thứ (ví dụ huy hiệu) tự hỏi hook là màn có hai nguồn: hook giữ cache
   * 10 phút, admin đổi `expiry.critical_days` thành 14 là bảng lọc theo 14 còn huy hiệu tô
   * theo 7.
   */
  const thresholds = useExpiryThresholds();

  /* Nguồn nhãn loại hạn dùng chung với bảng điều khiển — xem `lib/expiry-kinds.ts` (AD-15). */
  const kinds = useExpiryKinds();

  /*
   * PHÂN TRANG VÀ LỌC NHÓM Ở MÁY CHỦ.
   *
   * Kéo TRỌN cửa sổ về rồi lọc/sắp/bày tại chỗ là 7.662 dòng ở 30k hồ sơ, và ở 200k thì không
   * dùng được. Nó còn làm bẩn cả phiên: mở `/expiry` một lần thì màn kế tiếp cũng chậm theo
   * (9.730ms so với 582ms khi đo một mình), vì trình duyệt còn đang dọn 841k node.
   *
   * `state` đi CÙNG lên server, không lọc ở client. Lọc ở client thì bấm "Gấp" chỉ lọc trong
   * 50 dòng đang xem trong khi nút ngay trên đầu đề số 87 — một màn tự mâu thuẫn.
   */
  const expiry = useQuery({
    queryKey: ['expiry', withinDays, kind, state, sortParams, url.page, url.limit],
    // Đổi trang/từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới: vẽ lại Loading là gỡ cả bảng,
    // mất dòng đang bung và bảng nháy trắng sau mỗi lần gõ tìm.
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<ExpiryResponse>(
        `/api/v1/expiry?withinDays=${withinDays}&page=${url.page}&limit=${url.limit}` +
          `${kind ? `&kinds=${kind}` : ''}${state ? `&state=${state}` : ''}${sortParams}`,
      ),
  });
  useClampPage(url, expiry.data?.total);

  /*
   * `useCallback` chứ không phải hàm trần: nó nằm trong deps của `columns` bên dưới, và một
   * hàm mới mỗi render sẽ làm memo tính lại mỗi render — tức vô hiệu hoá chính cái memo.
   */
  const kindLabel = useCallback(
    (value: string) => kinds.data?.find((item) => item.kind === value)?.label ?? value,
    [kinds.data],
  );

  const summary = expiry.data?.summary;
  const failedLabels = (expiry.data?.failedKinds ?? []).map(kindLabel).join(', ');
  const incomplete = failedLabels
    ? t('expiry.kpiIncomplete', { kinds: failedLabels })
    : undefined;

  /*
   * Ba nhóm KHÔNG phủ kín bảng, và đó là đúng: dòng còn xa hơn ngưỡng "sắp tới" không thuộc
   * nhóm nào (server đếm y như vậy — xem `levelOf()` trong `expiry.service.ts`). Ba ô cộng lại
   * không bằng số dòng; chúng đếm "cần chú ý", không đếm "có bao nhiêu dòng".
   *
   * Ngưỡng ĐI KÈM lượt trả về, không phải từ `useExpiryThresholds()` — chỉ bộ này mới chắc chắn
   * là bộ mà `summary` đã dùng để đếm. Chưa về thì lùi về hook (nó có bản dự phòng riêng).
   *
   * Phép LỌC theo nhóm nằm ở server; ở đây `nguong` chỉ để TÔ MÀU.
   */
  const nguong = expiry.data?.thresholds ?? thresholds;
  const rows = expiry.data?.items ?? [];

  const byMonth: TableGroupBy<ExpiryRow> = {
    key: (row) => row.end.slice(0, 7),
    label: (month) =>
      t('expiry.monthGroup', { month: `${month.slice(5, 7)}/${month.slice(0, 4)}` }),
  };

  const columns = useMemo<ColumnDef<ExpiryRow, unknown>[]>(
    () => [
      {
        // Sắp ở MÁY CHỦ (`?sort=label`) — xem `manualSorting` ở <DataTable>.
        accessorKey: 'label',
        header: t('expiry.item'),
        cell: ({ row }) => (
          <>
            {row.original.code ? (
              <>
                <Link className="mono" to={row.original.link}>
                  {row.original.code}
                </Link>{' '}
                {row.original.name}
              </>
            ) : (
              <Link to={row.original.link}>{row.original.label}</Link>
            )}
            {row.original.sublabel ? (
              <span className="cell-sub">{row.original.sublabel}</span>
            ) : null}
            <AutoRetireNote row={row.original} />
          </>
        ),
      },
      {
        accessorKey: 'kind',
        header: t('expiry.kind'),
        cell: ({ row }) => kindLabel(row.original.kind),
      },
      {
        accessorKey: 'end',
        header: t('expiry.end'),
        cell: ({ row }) => (
          <>
            {orDash(formatDate(row.original.end))}
            {row.original.start ? (
              <span className="cell-sub">
                {t('expiry.startedOn', { date: formatDate(row.original.start) })}
              </span>
            ) : null}
          </>
        ),
      },
      {
        // Sắp theo "còn bao nhiêu ngày" chứ không theo chữ trên badge: xếp theo chữ thì
        // "Quá hạn 40 ngày" và "Quá hạn 2 ngày" đứng cạnh nhau vô nghĩa.
        accessorKey: 'daysLeft',
        // Cùng thứ tự với cột Hết hạn — sắp ở cột đó, không nhân đôi một nút sắp.
        enableSorting: false,
        header: t('expiry.state'),
        // AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts
        /* Truyền `nguong` — cùng bộ ngưỡng mà phép lọc và nhãn ô số dùng. Không truyền là màn
           này có hai nguồn: bảng lọc theo ngưỡng của lượt trả về, huy hiệu tô theo cache 10
           phút của hook. Xem chú thích prop `thresholds` ở `ui/expiry-badge.tsx`. */
        cell: ({ row }) => <ExpiryBadge end={row.original.end} thresholds={nguong} />,
      },
      {
        id: 'actions',
        header: t('common.actions'),
        meta: { className: 'col-center' },
        cell: ({ row }) =>
          row.original.canRenew ? (
            /*
             * Nút THƯỜNG, không phải nút chính.
             *
             * Bảng này hay dài ba chục dòng; MỖI dòng mang một nút nền gradient thương hiệu
             * thì ba chục nút cùng hét lên và không nút nào còn to tiếng: mắt mất
             * luôn chỗ bấu víu, và cái thật sự quan trọng trên màn — dòng nào ĐỎ vì đã quá
             * hạn — bị chính hàng nút xanh át đi. Màu chính để dành cho việc chính của trang.
             */
            <button type="button" className="btn sm" onClick={() => setRenewing(row.original)}>
              {t('expiry.renew')}
            </button>
          ) : (
            /* Bảo hành không gia hạn ở đây: cho lối sang hồ sơ (sửa ngày ở đó) thay vì một câu
               xám lặp lại trên mọi dòng, đọc như chữ của một nút bị vô hiệu. */
            <Link className="with-icon" to={row.original.link}>
              {t('expiry.openRecordShort')}
              <Chevron direction="right" />
            </Link>
          ),
      },
    ],
    /*
     * `nguong` PHẢI có mặt ở đây.
     *
     * Thiếu nó thì `cell` của cột Tình trạng đóng băng bộ ngưỡng của lượt render ĐẦU —
     * lúc `expiry.data` còn `undefined` nên `nguong` là `DEFAULT_EXPIRY_THRESHOLDS` (7/30).
     * Dữ liệu về mang ngưỡng thật (ví dụ 14/30), `rows` ở dòng trên lọc theo 14, còn huy hiệu
     * vẫn tô theo 7: ô "Gấp" ghi 6, bấm vào ra 6 dòng, chỉ 2 dòng đỏ. Đúng cảnh mà khối chú
     * thích ở `ui/expiry-badge.tsx:38-40` sinh ra để dẹp.
     *
     * Không bài kiểm nào bắt được vì 7/30 cũng là giá trị gieo sẵn trong `system_config` — mọi lượt chạy
     * dev/E2E đều ở đúng cấu hình che lỗi.
     */
    [t, kindLabel, nguong],
  );

  return (
    <>
      <PageHeader
        title={t('expiry.title')}
        subtitle={t('expiry.subtitle')}
        actions={
          tab === 'rules' ? (
            canEditRules ? (
              <button type="button" className="btn primary" onClick={() => setAddingRule(true)}>
                {t('digest.add')}
              </button>
            ) : null
          ) : tab === 'list' ? (
            /* Xuất ĐÚNG cửa sổ ngày, loại VÀ ô số đang bật — không phải cả bảng (FR-028). */
            <ExportXlsxButton
              url={
                `/api/v1/expiry/export.xlsx?withinDays=${withinDays}` +
                `${kind ? `&kinds=${kind}` : ''}${state ? `&state=${state}` : ''}${sortParams}`
              }
              fileName={state ? `sap-het-han-${EXPORT_SUFFIX[state]}.xlsx` : 'sap-het-han.xlsx'}
            />
          ) : null
        }
      />

      {/*
        BA CON SỐ NÀY LÀ THỨ NGƯỜI TA NHÌN ĐẦU TIÊN MỖI SÁNG — nên chúng phải ĐỌC ĐƯỢC và
        BẤM ĐƯỢC: biết có 4 thứ quá hạn mà vẫn phải tự dò trong bảng 30 dòng thì con số
        chẳng giúp gì. Bấm một ô là bảng thu về đúng nhóm ấy; bấm lại là bỏ lọc.
      */}
      {failedLabels && tab === 'list' ? (
        <div className="alert warn" role="status">
          {t('expiry.failedKinds', { kinds: failedLabels })}{' '}
          <button
            type="button"
            className="btn sm"
            disabled={expiry.isFetching}
            onClick={() => void expiry.refetch()}
          >
            {t('app.retry')}
          </button>
        </div>
      ) : null}

      {/* Ô số và dải cảnh báo chỉ nói về DANH SÁCH — ở tab Luật hay Đã gia hạn thì chúng lạc chỗ. */}
      {summary && tab === 'list' ? (
        <KpiStrip>
          <KpiTile
            value={summary.expired}
            label={t('expiry.expired')}
            tone="danger"
            active={state === 'expired'}
            incomplete={incomplete}
            onClick={() => setState(state === 'expired' ? '' : 'expired')}
          />
          <KpiTile
            value={summary.critical}
            label={t('expiry.critical', { days: nguong.criticalDays })}
            tone="danger"
            active={state === 'critical'}
            incomplete={incomplete}
            onClick={() => setState(state === 'critical' ? '' : 'critical')}
          />
          <KpiTile
            value={summary.warning}
            label={t('expiry.warningUpTo', { days: nguong.warningDays })}
            tone="warn"
            active={state === 'warning'}
            incomplete={incomplete}
            onClick={() => setState(state === 'warning' ? '' : 'warning')}
          />
          {/* Q-13: phần mềm quá ân hạn sẽ TỰ thanh lý và gỡ ghế — ô riêng để còn kịp cứu. */}
          {summary.autoRetire !== undefined ? (
            <KpiTile
              value={summary.autoRetire}
              label={t('expiry.kpiAutoRetire')}
              tone="danger"
              active={state === 'autoRetire'}
              incomplete={incomplete}
              onClick={() => setState(state === 'autoRetire' ? '' : 'autoRetire')}
            />
          ) : null}
        </KpiStrip>
      ) : null}

      <Tabs
        items={[
          { key: 'list', label: t('expiry.tabList') },
          { key: 'renewals', label: t('expiry.tabRenewals') },
          { key: 'rules', label: t('digest.tab') },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('expiry.title')}
      />

      {tab === 'rules' ? (
        <TabPanel tabKey="rules">
          {/*
            DANH SÁCH LOẠI HỎNG THÌ KHÔNG ĐƯỢC MỞ TRÌNH SOẠN LUẬT.
            `kinds.data ?? []` khiến hộp thoại "Thêm luật" hiện ra KHÔNG MỘT ô tick nào, y hệt
            lúc hệ thống thật sự chưa đăng ký loại nào. Người dùng lưu được một luật digest
            theo dõi RỖNG — nó không bao giờ gửi email, và không có gì trên màn nói vì sao.
          */}
          {kinds.isError ? (
            <LoadError error={kinds.error} onRetry={() => void kinds.refetch()} />
          ) : (
            <DigestRulesPanel
              me={me}
              kinds={kinds.data ?? []}
              adding={addingRule}
              onAddingChange={setAddingRule}
            />
          )}
        </TabPanel>
      ) : tab === 'renewals' ? (
        <TabPanel tabKey="renewals">
          <RenewalsPanel kindLabel={kindLabel} />
        </TabPanel>
      ) : (
        <TabPanel tabKey="list">
      <FilterBar>
        <Select
          value={period || String(withinDays)}
          ariaLabel={t('expiry.window')}
          /* Chín mốc cố định, đọc lướt là thấy — ô gõ lọc chỉ thêm một bước. */
          searchable={false}
          options={[
            ...WINDOWS.map((days) => ({
              value: String(days),
              label: t('expiry.windowDays', { days }),
            })),
            { value: 'month', label: t('expiry.windowMonth') },
            { value: 'quarter', label: t('expiry.windowQuarter') },
            { value: 'custom', label: t('expiry.windowCustom') },
          ]}
          onChange={setWindow}
        />
        {period === 'custom' ? (
          <DatePicker
            value={url.filters.until}
            ariaLabel={t('expiry.windowUntil')}
            placeholder={t('expiry.windowUntil')}
            min={today}
            onChange={(value) => url.setFilter('until', value)}
          />
        ) : null}
        {/* Chọn NHIỀU loại một lượt (người lo web xem SSL + tên miền cùng lúc) — API nhận
            `?kinds=a,b`. */}
        <ChipToggleGroup
          label={t('expiry.kind')}
          allLabel={t('expiry.allKinds')}
          options={(kinds.data ?? []).map((item) => ({ value: item.kind, label: item.label }))}
          value={kind ? kind.split(',') : []}
          onChange={(next) => setKind(next.join(','))}
        />
      </FilterBar>

      {expiry.isLoading ? (
        <Loading />
      ) : expiry.isError ? (
        <LoadError error={expiry.error} onRetry={() => void expiry.refetch()} />
      ) : rows.length === 0 ? (
        /* Rỗng vì ĐANG LỌC thì phải nói đúng lý do đó. Câu "nới cửa sổ ra 90 ngày" là lời
           khuyên sai khi thứ chặn lại là cái ô số vừa bấm — người dùng nới cửa sổ, vẫn rỗng,
           và không hiểu vì sao. */
        <EmptyState
          title={state ? t('expiry.emptyFiltered') : t('expiry.empty')}
          hint={state ? t('expiry.emptyFilteredHint') : t('expiry.emptyHint')}
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          emptyText={t('expiry.empty')}
          stackOnMobile
          /* ≤600px: thẻ 2 dòng — mục + badge ngày, rồi "loại · ngày hết hạn" và nút Gia hạn
             nhỏ nếu gia hạn được tại đây. */
          mobileCard={{
            title: (row) => row.code ?? row.label,
            subtitle: (row) => (row.code ? row.name : undefined),
            href: (row) => row.link,
            badge: (row) => <ExpiryBadge end={row.end} thresholds={nguong} />,
            meta: (row) => `${kindLabel(row.kind)} · ${formatDate(row.end)}`,
            aside: (row) =>
              row.canRenew ? (
                <button type="button" className="btn sm" onClick={() => setRenewing(row)}>
                  {t('expiry.renew')}
                </button>
              ) : null,
          }}
          /*
           * Sắp ở MÁY CHỦ (`?sort=&dir=`, EX-011): sắp ở client chỉ đảo chỗ 50 dòng đang xem.
           * Mặc định ngày hết hạn tăng dần — GẤP NHẤT LÊN ĐẦU, lý do màn này tồn tại.
           */
          manualSorting
          sorting={sorting}
          onSortingChange={(updater) => {
            const next = typeof updater === 'function' ? updater(sorting) : updater;
            const first = next[0];
            url.setSorting(
              first ? { key: String(first.id), desc: !!first.desc } : { key: 'end', desc: false },
            );
          }}
          /* Đang sắp theo ngày thì gom theo THÁNG hết hạn ("Tháng 10/2026") — câu hỏi ngân
             sách là theo tháng. Sắp theo cột khác thì nhóm tháng vô nghĩa nên bỏ. */
          groupBy={sortKey === 'end' ? byMonth : undefined}
          rowClassName={(row) => (row.daysLeft < 0 ? 'row-danger' : '')}
          /* Chọn nhiều dòng để gia hạn một lượt (cuối năm cả chục license/SSL cùng một hợp
             đồng). Dòng không gia hạn được ở đây thì bỏ qua lúc chạy, và nói ra con số đó. */
          selection={{
            selected,
            onToggle: (id) =>
              setSelected((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              }),
            onToggleAll: (ids, checked) =>
              setSelected((current) => {
                const next = new Set(current);
                for (const id of ids) {
                  if (checked) next.add(id);
                  else next.delete(id);
                }
                return next;
              }),
          }}
        />
      )}

      {selected.size > 0 ? (
        <BulkRenewBar
          rows={rows.filter((row) => selected.has(row.id))}
          csrfToken={me.csrfToken}
          askConfirm={askConfirm}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            void queryClient.invalidateQueries({ queryKey: ['expiry'] });
          }}
        />
      ) : null}

      <Pagination
        page={url.page}
        limit={url.limit}
        onLimitChange={url.setLimit}
        total={expiry.data?.total ?? 0}
        onPageChange={url.setPage}
      />

        </TabPanel>
      )}

      {renewing ? (
        <RenewDialog
          row={{ ...renewing, code: renewing.code }}
          kindLabel={kindLabel(renewing.kind)}
          csrfToken={me.csrfToken}
          withTerms={renewing.canRenewTerms}
          /* Dòng vừa gia hạn rời danh sách — nút của CHÍNH toast "Đã gia hạn …" chỉ đường tới chỗ
             nó đã sang, để kiểm lại được. Một toast, không phải hai. */
          toastAction={{
            label: t('expiry.renewedSeeTabAction'),
            onClick: () => setTab('renewals'),
          }}
          onClose={() => setRenewing(null)}
          onDone={() => {
            setRenewing(null);
            void queryClient.invalidateQueries({ queryKey: ['expiry'] });
          }}
        />
      ) : null}
    </>
  );
}

/** Hậu tố tên file xuất theo ô số đang bật — khớp `EXPORT_SUFFIX` phía API. */
const EXPORT_SUFFIX = {
  expired: 'qua-han',
  critical: 'gap',
  warning: 'sap-toi',
  autoRetire: 'cho-tu-thanh-ly',
} as const;

/** Số mục gia hạn một lượt theo lô: đủ cho "cuối năm", không đủ để lỡ tay gia hạn cả kho. */
const BULK_MONTHS = 12;

/**
 * Dòng phụ đỏ "tự thanh lý sau N ngày" của mục phần mềm đã Hết hạn (Q-13) — màn này là nơi cuối
 * cùng còn kịp gia hạn trước khi hồ sơ vào Kho thanh lý và mọi ghế bị gỡ.
 */
function AutoRetireNote({ row }: { row: ExpiryRow }) {
  const { t } = useTranslation();
  if (!row.autoRetireOn || row.daysLeft >= 0) return null;
  const days = Math.max(0, daysUntil(row.autoRetireOn));
  return (
    <span className="cell-sub is-danger">
      {t('expiry.autoRetireOn', { count: days, date: formatDate(row.autoRetireOn) })}
    </span>
  );
}

/**
 * Thanh dính đáy khi đã chọn dòng: gia hạn +1 năm cho cả lô (mỗi mục tính từ hạn của chính nó,
 * hoặc từ hôm nay nếu đã quá hạn — `renewPreset`). Chạy từng mục qua cùng `POST /expiry/renew`
 * của hộp Gia hạn, nên luật của module chủ vẫn áp cho từng dòng.
 */
function BulkRenewBar({
  rows,
  csrfToken,
  askConfirm,
  onClear,
  onDone,
}: {
  rows: ExpiryRow[];
  csrfToken: string;
  askConfirm: ReturnType<typeof useConfirm>;
  onClear: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const renew = useApiMutation<Record<string, unknown>, unknown>('/api/v1/expiry/renew', {
    csrfToken,
    refreshMe: false,
  });
  const renewable = rows.filter((row) => row.canRenew);

  const run = async () => {
    const ok = await askConfirm({
      title: t('expiry.bulkTitle', { count: renewable.length }),
      message: t('expiry.bulkConfirm', {
        count: renewable.length,
        items: renewable.map((row) => row.code ?? row.label).join(', '),
      }),
      confirmLabel: t('expiry.bulkRenew', { count: renewable.length }),
    });
    if (!ok) return;
    setBusy(true);
    const today = todayIso();
    let done = 0;
    for (const row of renewable) {
      try {
        await renew.mutateAsync({
          kind: row.kind,
          id: row.id,
          endDate: renewPreset(row.end, today, BULK_MONTHS),
        });
        done += 1;
      } catch {
        toast({
          message: t('expiry.bulkFailed', { item: row.code ?? row.label }),
          tone: 'warn',
        });
      }
    }
    setBusy(false);
    toast({ message: t('expiry.bulkDone', { count: done }) });
    onDone();
  };

  return (
    <StickyActionBar
      label={t('expiry.bulkLabel')}
      note={
        rows.length > renewable.length
          ? t('expiry.bulkSkipped', { count: rows.length - renewable.length })
          : t('expiry.bulkSelected', { count: rows.length })
      }
    >
      <button type="button" className="btn" disabled={busy} onClick={onClear}>
        {t('expiry.bulkClear')}
      </button>
      <button
        type="button"
        className="btn primary"
        disabled={busy || renewable.length === 0}
        onClick={() => void run()}
      >
        {busy ? t('common.loading') : t('expiry.bulkRenew', { count: renewable.length })}
      </button>
    </StickyActionBar>
  );
}

/** Tab "Đã gia hạn": các lượt gia hạn gần nhất (`GET /expiry/renewals`) — ai, lúc nào, cũ → mới. */
function RenewalsPanel({ kindLabel }: { kindLabel: (kind: string) => string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState({ from: '', to: '' });
  const query = renewalsQuery(range);
  const renewals = useQuery({
    queryKey: ['expiry', 'renewals', query],
    queryFn: () => apiFetch<RenewalRow[]>(`/api/v1/expiry/renewals${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
  });
  const columns = useMemo<ColumnDef<RenewalRow, unknown>[]>(
    () => [
      {
        accessorKey: 'createdAt',
        enableSorting: false,
        header: t('expiry.renewedAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'label',
        enableSorting: false,
        header: t('expiry.item'),
        // Chỉ hồ sơ phần mềm ghi lượt gia hạn — link về đúng trang chi tiết của nó.
        cell: ({ row }) => (
          <Link to={PATHS.softwareItem(row.original.objectId)}>{row.original.label}</Link>
        ),
      },
      {
        accessorKey: 'objectKind',
        enableSorting: false,
        header: t('expiry.kind'),
        cell: ({ row }) => kindLabel(row.original.objectKind),
      },
      {
        id: 'ends',
        enableSorting: false,
        header: t('expiry.oldToNew'),
        cell: ({ row }) =>
          `${orDash(formatDate(row.original.oldEnd))} → ${formatDate(row.original.newEnd)}`,
      },
      {
        accessorKey: 'actor',
        enableSorting: false,
        header: t('expiry.renewedBy'),
        cell: ({ row }) =>
          row.original.actorName ? (
            <span title={row.original.actor}>{row.original.actorName}</span>
          ) : (
            row.original.actor
          ),
      },
    ],
    [t, kindLabel],
  );

  const filtered = query !== '';
  const filterBar = (
    <FilterBar
      activeCount={[range.from, range.to].filter(Boolean).length}
      onClear={() => setRange({ from: '', to: '' })}
    >
      <div className="filter-range" role="group" aria-label={t('expiry.renewalsRange')}>
        <DatePicker
          value={range.from}
          ariaLabel={t('expiry.renewalsFrom')}
          placeholder={t('expiry.renewalsFrom')}
          max={range.to || undefined}
          onChange={(from) => setRange((current) => ({ ...current, from }))}
        />
        <DatePicker
          value={range.to}
          ariaLabel={t('expiry.renewalsTo')}
          placeholder={t('expiry.renewalsTo')}
          min={range.from || undefined}
          onChange={(to) => setRange((current) => ({ ...current, to }))}
        />
      </div>
    </FilterBar>
  );

  if (renewals.isLoading) return <Loading />;
  if (renewals.isError) {
    return <LoadError error={renewals.error} onRetry={() => void renewals.refetch()} />;
  }
  const rows = renewals.data ?? [];
  if (rows.length === 0) {
    return (
      <>
        {filterBar}
        <EmptyState
          title={t(filtered ? 'expiry.renewalsEmptyFiltered' : 'expiry.renewalsEmpty')}
          hint={filtered ? undefined : t('expiry.renewalsEmptyHint')}
        />
      </>
    );
  }
  return (
    <>
      {filterBar}
      <DataTable
        data={rows}
        columns={columns}
        emptyText={t('expiry.renewalsEmpty')}
        stackOnMobile
        mobileCard={{
          title: (row) => row.label,
          href: (row) => PATHS.softwareItem(row.objectId),
          meta: (row) =>
            `${orDash(formatDate(row.oldEnd))} → ${formatDate(row.newEnd)} · ${row.actorName ?? row.actor}`,
          aside: (row) => formatDate(row.createdAt),
        }}
      />
    </>
  );
}
