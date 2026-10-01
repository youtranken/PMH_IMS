import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { CellNote } from '@/ui/cell-note';
import { DeviceCombobox } from '@/ui/device-combobox';
import { Dialog, DialogCancel } from '@/ui/dialog';
import {
  DeviceTypeFilter,
  isRouterType,
  useDeviceTypeFilter,
} from '@/ui/device-type-filter';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { RowActions } from '@/ui/row-actions';
import { Field, FormSection, PageHeader } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import type { ServicePortRow } from '@/lib/catalog-types';
import { CatalogForm } from '@/features/catalog/catalog-form';
import { DeviceForm } from '@/features/devices/device-form';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { HistoryPanel } from '@/ui/history-panel';
import { ServicePortPicker } from './service-port-picker';
import { toNatHistory, type NatHistoryRow } from './nat-history-entries';
import { checkInternalIp } from './nat-internal-ip';
import { STATUS_KEY, type IpSearchHit, type IpStatus } from './ipam-types';
import { parseIpv4, subnetOf } from '@/lib/ipv4';
import { chipsFromValue, parsePortChip, type PortChip } from './port-chips';
import { PortChipsField } from './port-chips-field';
import {
  countNat,
  filterNat,
  NAT_BUCKET_KEY,
  NAT_BUCKETS,
  NAT_DEFAULT_SHOWN,
  NAT_SORT_KEYS,
  natBucket,
  sortNat,
  type NatBucket,
  type NatSortKey,
} from './nat-buckets';
import { sensitivePortOf } from './nat-sensitive';
import { serviceNameFor, wanByRouter } from './nat-context';
import { useIpamSettings } from './ipam-settings';
import { PATHS } from '@/lib/routes';
import { clampPage } from '@/lib/paging';
import { useCatalogLists } from '@/ui/use-catalog-lists';
import { reasonRule, secretTextRule, useFormErrors } from '@/ui/use-form-errors';
import { useConfirm } from '@/ui/confirm-provider';
import { Pagination } from '@/ui/pagination';
import { useListUrlState } from '@/ui/use-list-url-state';

type NatProtocol = 'tcp' | 'udp' | 'both';

interface NatRow {
  id: string;
  deviceId: string;
  deviceCode: string | null;
  deviceName: string | null;
  siteCode: string | null;
  protocol: NatProtocol;
  externalPorts: string;
  internalIp: string;
  internalPort: number;
  ipAddressId: string | null;
  internalOwner: string | null;
  /** Máy ĐƯỢC NAT (khác `deviceId` — con router thực hiện NAT). Suy từ hồ sơ IP. */
  internalDeviceId: string | null;
  internalDeviceCode: string | null;
  usedBy: string;
  reason: string;
  enabled: boolean;
  note: string | null;
  /** Ai mở, lúc nào — câu kiểm toán "port này mở từ bao giờ". */
  createdBy: string;
  createdAt: string;
  /** Rule đã gỡ — màn luôn xin `includeVoided=true` để chip "Đã gỡ" có số thật. */
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

/** Bộ lọc của sổ NAT — nằm trên URL: Back giữ bộ lọc, và gửi được link "sổ NAT của FW-01". */
interface NatFilters extends Record<string, string> {
  search: string;
  siteId: string;
  /** Router mang rule — lọc ở client vì danh sách router lấy từ chính các rule đang có. */
  deviceId: string;
  protocol: '' | NatProtocol;
  /** '1' = chỉ rule mở cổng nhạy cảm. */
  sensitive: '' | '1';
}

const EMPTY_NAT_FILTERS: NatFilters = {
  search: '',
  siteId: '',
  deviceId: '',
  protocol: '',
  sensitive: '',
};

const NAT_PAGE_SIZE = 50;

/** Chữ của giao thức — "both" là mã kỹ thuật, người đọc thấy "TCP + UDP" như ô chọn trong form. */
function protocolLabel(protocol: NatProtocol, t: (key: string) => string): string {
  return protocol === 'both' ? t('catalog.protocolBoth') : protocol.toUpperCase();
}

/**
 * Sổ NAT (FR-017).
 *
 * Bảng này tồn tại để trả lời đúng ba câu của auditor: **port nào mở, vì sao, cho ai**. Nên
 * cả ba đều nằm NGAY TRÊN BẢNG, không giấu trong trang chi tiết — người ta mở màn này ra là
 * để đọc, không phải để bấm tiếp.
 */
export function NatScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const url = useListUrlState<NatFilters>({
    emptyFilters: EMPTY_NAT_FILTERS,
    defaultLimit: NAT_PAGE_SIZE,
    defaultSort: { key: 'external', desc: false },
    searchKey: 'search',
  });
  const filters = url.filters;
  const sortKey: NatSortKey = NAT_SORT_KEYS.includes(url.sorting.key as NatSortKey)
    ? (url.sorting.key as NatSortKey)
    : 'external';
  const [editing, setEditing] = useState<{ rule: NatRow | null } | null>(null);
  const [hiding, setHiding] = useState<NatRow | null>(null);
  const [historyOf, setHistoryOf] = useState<NatRow | null>(null);
  const [shown, setShown] = useState<Record<NatBucket, boolean>>(NAT_DEFAULT_SHOWN);
  const settings = useIpamSettings();

  const canHide = me.role === 'sa' || me.role === 'admin';

  const lists = useCatalogLists();

  // Ô tìm và site đi xuống API (tìm theo port nằm trong dải chỉ API làm đúng được); router,
  // giao thức và cổng nhạy cảm lọc tại chỗ trên cả sổ đã về.
  const query = new URLSearchParams();
  if (filters.search.trim()) query.set('search', filters.search.trim());
  if (filters.siteId) query.set('siteId', filters.siteId);

  // Xin luôn cả rule đã gỡ: chip "Đã gỡ" phải mang con số thật ngay cả khi đang tắt.
  const listQuery = new URLSearchParams(query);
  listQuery.set('includeVoided', 'true');
  // Bản xuất đi theo đúng thứ đang bày trên màn: chỉ kèm rule đã gỡ khi chip đó đang bật.
  const exportQuery = new URLSearchParams(query);
  if (filters.deviceId) exportQuery.set('deviceId', filters.deviceId);
  if (shown.voided) exportQuery.set('includeVoided', 'true');

  const rules = useQuery({
    queryKey: ['ipam', 'nat', filters.search, filters.siteId, 'withVoided'],
    // Đổi từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới: vẽ lại Loading là gỡ cả bảng,
    // mất dòng đang bung/menu đang mở và bảng nháy trắng sau mỗi lần gõ tìm.
    placeholderData: keepPreviousData,
    queryFn: () => apiFetch<NatRow[]>(`/api/v1/ipam/nat?${listQuery.toString()}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam', 'nat'] });
  const all = useMemo(() => rules.data ?? [], [rules.data]);

  /* Rule đi ra WAN nào: IP WAN của đường truyền gắn cùng router (một văn phòng chỉ vài đường,
     một lượt đủ). Hỏng hay chưa về thì dòng chỉ thiếu phần WAN, bảng vẫn đọc được. */
  const ispLines = useQuery({
    queryKey: ['isp', 'nat-wan'],
    queryFn: () =>
      apiFetch<{ items: { deviceId: string | null; wanIps: string[] }[] }>(
        '/api/v1/isp-lines?limit=200',
      ),
  });
  const wanOf = useMemo(() => wanByRouter(ispLines.data?.items ?? []), [ispLines.data]);
  const services = useMemo(() => lists.data?.servicePorts ?? [], [lists.data]);
  const sensitiveOf = (rule: NatRow) =>
    sensitivePortOf(rule.externalPorts, rule.internalPort, settings.natSensitivePorts);

  /** Router có mặt trong sổ — ô lọc chỉ bày thứ lọc ra được. */
  const routers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const rule of all) seen.set(rule.deviceId, rule.deviceCode ?? rule.deviceId);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const narrowed = all.filter(
    (rule) =>
      (!filters.deviceId || rule.deviceId === filters.deviceId) &&
      (!filters.protocol || rule.protocol === filters.protocol) &&
      (!filters.sensitive || sensitiveOf(rule) !== null),
  );
  const counts = countNat(narrowed);
  const rows = sortNat(filterNat(narrowed, shown), sortKey);
  const page = clampPage(url.page, rows.length, url.limit);
  const pageRows = rows.slice((page - 1) * url.limit, page * url.limit);
  const filtered = url.isFiltered;

  /** Tắt/bật tạm một rule ngay từ menu — việc hay gặp nhất, không phải mở cả form Sửa. */
  const toggleRule = async (rule: NatRow) => {
    const ports = `${protocolLabel(rule.protocol, t)} ${rule.externalPorts}`;
    const ok = await askConfirm({
      title: t(rule.enabled ? 'nat.disableTitle' : 'nat.enableTitle', { ports }),
      message: t(rule.enabled ? 'nat.disableMessage' : 'nat.enableMessage'),
      confirmLabel: t(rule.enabled ? 'nat.disableRule' : 'nat.enableRule'),
    });
    if (!ok) return;
    try {
      await apiFetch(`/api/v1/ipam/nat/${rule.id}`, {
        method: 'PATCH',
        csrfToken: me.csrfToken,
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      toast({ message: t('nat.toggled') });
      void refresh();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    }
  };

  return (
    <>
      <PageHeader
        title={t('nat.title')}
        subtitle={t('nat.subtitle')}
        actions={
          <>
            <ExportXlsxButton
              url={`/api/v1/ipam/nat/export.xlsx?${exportQuery.toString()}`}
              fileName="so-nat.xlsx"
            />
            <button type="button" className="btn primary" onClick={() => setEditing({ rule: null })}>
              {t('nat.add')}
            </button>
          </>
        }
      />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('nat.search')}
      >
        <Select
          value={filters.siteId}
          onChange={(value) => url.setFilter('siteId', value)}
          ariaLabel={t('nat.site')}
          placeholder={t('nat.allSites')}
          options={[
            { value: '', label: t('nat.allSites') },
            ...(lists.data?.sites ?? []).map((site) => ({ value: site.id, label: site.code })),
          ]}
          failed={lists.isError}
        />
        <Select
          value={filters.deviceId}
          onChange={(value) => url.setFilter('deviceId', value)}
          ariaLabel={t('nat.router')}
          placeholder={t('nat.allRouters')}
          options={[
            { value: '', label: t('nat.allRouters') },
            ...routers.map(([id, code]) => ({ value: id, label: code })),
          ]}
        />
        <Select
          value={filters.protocol}
          onChange={(value) => url.setFilter('protocol', value)}
          ariaLabel={t('nat.protocol')}
          placeholder={t('nat.allProtocols')}
          options={[
            { value: '', label: t('nat.allProtocols') },
            ...PROTOCOLS.map((protocol) => ({ value: protocol, label: protocolLabel(protocol, t) })),
          ]}
        />
        {/* Ba chip bật/tắt độc lập, không phải chọn-một: "đang mở + đã tắt" là mặc định
            (mọi thứ còn trong sổ), và auditor hay cần thêm "đã gỡ" chứ không thay cái kia. */}
        <div className="segmented" role="group" aria-label={t('nat.bucketGroup')}>
          {NAT_BUCKETS.map((bucket) => (
            <button
              key={bucket}
              type="button"
              className={shown[bucket] ? 'on' : undefined}
              aria-pressed={shown[bucket]}
              onClick={() => setShown((current) => ({ ...current, [bucket]: !current[bucket] }))}
            >
              {t(NAT_BUCKET_KEY[bucket])} <span className="seg-count">{counts[bucket]}</span>
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label={t('nat.sensitive')}>
          <button
            type="button"
            className={filters.sensitive ? 'on' : undefined}
            aria-pressed={filters.sensitive === '1'}
            onClick={() => url.setFilter('sensitive', filters.sensitive ? '' : '1')}
          >
            {t('nat.sensitiveOnly')}
          </button>
        </div>
        <Select
          value={sortKey}
          onChange={(value) => url.setSorting({ key: value, desc: false })}
          ariaLabel={t('nat.sortBy')}
          options={NAT_SORT_KEYS.map((key) => ({ value: key, label: t(SORT_LABEL[key]) }))}
        />
      </FilterBar>

      {rules.isLoading ? (
        <Loading />
      ) : rules.isError ? (
        <LoadError error={rules.error} onRetry={() => void rules.refetch()} />
      ) : all.length === 0 && !filtered ? (
        <EmptyState
          title={t('nat.empty')}
          hint={t('nat.emptyHint')}
          action={
            <button type="button" className="btn primary" onClick={() => setEditing({ rule: null })}>
              {t('nat.add')}
            </button>
          }
        />
      ) : narrowed.length === 0 ? (
        /* Tìm/lọc không ra thì NÓI là lọc không ra — câu "Chưa có rule NAT nào" ở đây làm
           người ta tưởng cả sổ trống. */
        <EmptyState
          title={t('nat.emptySearch')}
          hint={t('nat.emptySearchHint')}
          action={
            <button type="button" className="btn" onClick={url.clearFilters}>
              {t('common.clearFilters')}
            </button>
          }
        />
      ) : rows.length === 0 ? (
        /* Chỉ mấy chip trạng thái đang ẩn hết: nút đưa chip về mặc định và bỏ luôn bộ lọc. */
        <EmptyState
          title={t('nat.emptyFiltered')}
          hint={t('nat.emptyFilteredHint')}
          action={
            <button
              type="button"
              className="btn"
              onClick={() => {
                setShown(NAT_DEFAULT_SHOWN);
                url.clearFilters();
              }}
            >
              {t('common.clearFilters')}
            </button>
          }
        />
      ) : (
        <>
        <p className="muted nat-count">{t('nat.countLine', { count: rows.length })}</p>
        <div className="table-wrap">
          {/*
            `wide` — sàn bề ngang 66rem (table.css). Sáu cột mà không có sàn thì ở cột chính
            ~800px trình duyệt bóp đều tay: cột "Lý do mở" (văn xuôi) và cột "Chuyển tiếp" cùng
            bị ép xuống gãy ba bốn dòng. Dưới 961px `.table-stack` đã gập thẻ dọc nên sàn không
            áp; ≤600px mỗi rule là thẻ ba dòng (`.nat-table`).
          */}
          <table className="table table-stack wide nat-table">
            <thead>
              <tr>
                <th>{t('nat.router')}</th>
                <th>{t('nat.colForward')}</th>
                <th>{t('nat.usedBy')}</th>
                <th>{t('nat.reason')}</th>
                <th>{t('nat.status')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((rule) => {
                const voided = natBucket(rule) === 'voided';
                const sensitive = sensitiveOf(rule);
                const ports = `${protocolLabel(rule.protocol, t)} ${rule.externalPorts}`;
                const wan = wanOf.get(rule.deviceId);
                const service = serviceNameFor(rule.internalPort, rule.protocol, services);
                return (
                <tr key={rule.id} className={voided ? 'row-muted' : undefined}>
                  <td data-label={t('nat.router')} className="col-router">
                    <Link to={PATHS.device(rule.deviceId)}>{orDash(rule.deviceCode)}</Link>
                    <span className="cell-sub">{orDash(rule.siteCode)}</span>
                  </td>
                  {/* Một câu đọc ngang: ngoài → trong. Hai nửa là hai phần tử riêng để tìm
                      và bám được từng nửa ("TCP 8080", "10.0.0.5:80"). */}
                  <td data-label={t('nat.colForward')} className="col-flow">
                    <span className="nat-flow">
                      {/* WAN của router đứng trước cổng ngoài: "đi vào từ đâu" là nửa đầu
                          của câu. Nhiều đường thì hiện đủ, ngăn bằng "/". */}
                      {wan ? (
                        <span className="muted mono" title={t('nat.wanTitle')}>
                          {t('nat.wanPrefix', { wan: wan.join(' / ') })}
                        </span>
                      ) : null}
                      <span className={voided ? 'mono strike' : 'mono'}>{ports}</span>
                      <span className="nat-arrow" aria-hidden="true">→</span>
                      <span className={voided ? 'mono strike' : 'mono'}>
                        {rule.internalIp}:{rule.internalPort}
                      </span>
                      {service ? <span className="muted">({service})</span> : null}
                      {sensitive !== null ? (
                        <span
                          className="badge warn"
                          title={t('nat.sensitiveTitle', { port: sensitive })}
                        >
                          {t('nat.sensitive')}
                        </span>
                      ) : null}
                    </span>
                    {/* MÁY ĐÍCH ngay trên bảng: "dẫn tới 172.16.10.5" mà không nói đó là máy
                        nào thì người đọc sổ vẫn phải sang màn IP tra tiếp. Chủ IP trùng
                        "Mở cho ai" thì không lặp lại. */}
                    {rule.internalDeviceId ? (
                      <span className="cell-sub">
                        <Link className="mono" to={PATHS.device(rule.internalDeviceId)}>
                          {rule.internalDeviceCode}
                        </Link>
                        {rule.internalOwner && rule.internalOwner !== rule.usedBy
                          ? ` · ${rule.internalOwner}`
                          : ''}
                      </span>
                    ) : rule.internalOwner && rule.internalOwner !== rule.usedBy ? (
                      <span className="cell-sub">{rule.internalOwner}</span>
                    ) : null}
                  </td>
                  <td data-label={t('nat.usedBy')}>{rule.usedBy}</td>
                  {/* Lý do là văn xuôi gõ tự do: hai dòng, đủ câu ở `title`; ≤960px bảng gập
                      thẻ dọc thì đọc đủ. Dưới là "mở bao giờ, ai mở" — câu kiểm toán hỏi. */}
                  <td data-label={t('nat.reason')} className="col-reason">
                    <span className="cell-clamp-2" title={rule.reason}>
                      {rule.reason}
                    </span>
                    {rule.note ? <CellNote text={rule.note} className="cell-sub" /> : null}
                    <span className="cell-sub" title={rule.createdBy}>
                      {t('nat.openedBy', {
                        date: formatDate(rule.createdAt),
                        by: rule.createdBy.split('@')[0],
                      })}
                    </span>
                  </td>
                  {/*
                    Trạng thái là CỘT riêng, không dính vào số port: "Đã tắt" là trạng thái của
                    CẢ rule và là thứ auditor soi kỹ nhất — nó phải đọc rõ ở cả hai theme, nên
                    không làm mờ cả dòng mà dùng huy hiệu đỏ, cùng màu "Đã ngừng dùng" ở mọi
                    màn (Q-18).
                  */}
                  <td data-label={t('nat.status')} className="col-status">
                    {voided ? (
                      <span className="badge muted" title={rule.voidReason ?? undefined}>
                        {t('nat.voidedBadge', {
                          date: formatDate(rule.voidedAt),
                          by: rule.voidedBy ?? '—',
                          reason: rule.voidReason ?? '—',
                        })}
                      </span>
                    ) : rule.enabled ? (
                      <span className="badge ok">{t('nat.bucketOpen')}</span>
                    ) : (
                      <span className="badge danger">{t('nat.disabled')}</span>
                    )}
                  </td>
                  <td data-label={t('common.actions')} className="col-actions">
                    <RowActions
                        // Rule đã gỡ chỉ còn để TRA: sửa, bật/tắt hay gỡ tiếp đều bị API từ chối.
                        primary={
                          voided
                            ? undefined
                            : {
                                label: t('common.edit'),
                                ariaLabel: t('common.editOf', { subject: ports }),
                                onClick: () => setEditing({ rule }),
                              }
                        }
                        label={t('common.actionsOf', { subject: ports })}
                        items={[
                          {
                            key: 'history',
                            label: t('nat.history'),
                            onSelect: () => setHistoryOf(rule),
                          },
                          ...(voided
                            ? []
                            : [
                                {
                                  key: 'toggle',
                                  label: t(rule.enabled ? 'nat.disableRule' : 'nat.enableRule'),
                                  onSelect: () => void toggleRule(rule),
                                  warn: rule.enabled,
                                  ok: !rule.enabled,
                                },
                              ]),
                          ...(canHide && !voided
                            ? [
                                {
                                  key: 'remove',
                                  label: t('nat.remove'),
                                  onSelect: () => setHiding(rule),
                                  danger: true,
                                },
                              ]
                            : []),
                        ]}
                      />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          page={page}
          limit={url.limit}
          total={rows.length}
          onPageChange={url.setPage}
          onLimitChange={url.setLimit}
        />
        </>
      )}

      {editing ? (
        <NatForm
          rule={editing.rule}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onPartial={({ created, warnings }) => {
            // Bảng phía sau phải phản ánh mấy dòng vừa ghi được, dù hộp còn mở.
            toast({
              message: created > 1 ? t('nat.savedMany', { count: created }) : t('nat.saved'),
            });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
          onSaved={({ created, warnings }) => {
            setEditing(null);
            // Nói RÕ vừa ghi mấy dòng: gõ một form ra ba dòng là chuyện dễ đếm nhầm.
            toast({
              message: created > 1 ? t('nat.savedMany', { count: created }) : t('nat.saved'),
            });
            /**
             * Cảnh báo (vd "dải này mở hơn 1000 cổng") KHÔNG chặn lưu — nên nó phải được NÓI
             * RA sau khi lưu, không thì im lặng luôn và người khai chẳng biết mình vừa mở
             * bao nhiêu cổng ra Internet. Khoảng nào ghi hỏng cũng đi đường này.
             */
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}

      {historyOf ? (
        <Dialog
          open
          onOpenChange={() => setHistoryOf(null)}
          initialFocus="title"
          maxWidth={620}
          title={t('nat.historyOf', {
            ports: `${protocolLabel(historyOf.protocol, t)} ${historyOf.externalPorts}`,
          })}
          footer={
            <button type="button" className="btn" onClick={() => setHistoryOf(null)}>
              {t('common.close')}
            </button>
          }
        >
          <NatHistory ruleId={historyOf.id} />
        </Dialog>
      ) : null}

      {hiding ? (
        <RemoveDialog
          rule={hiding}
          csrfToken={me.csrfToken}
          onClose={() => setHiding(null)}
          onDone={() => {
            setHiding(null);
            toast({ message: t('nat.removed') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

const SORT_LABEL: Record<NatSortKey, string> = {
  external: 'nat.sortExternal',
  router: 'nat.sortRouter',
  internal: 'nat.sortInternal',
  newest: 'nat.sortNewest',
};

const PROTOCOLS: NatProtocol[] = ['tcp', 'udp', 'both'];

function NatForm({
  rule,
  csrfToken,
  onClose,
  onSaved,
  onPartial,
}: {
  rule: NatRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: { created: number; warnings: string[] }) => void;
  /** Ghi được một phần: làm mới bảng phía sau nhưng KHÔNG đóng hộp. */
  onPartial: (result: { created: number; warnings: string[] }) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState(rule?.deviceId ?? '');
  const [deviceTerm, setDeviceTerm] = useState(rule?.deviceCode ?? '');
  /** Loại của máy vừa chọn — chỉ để cảnh báo nhẹ "không phải Router" (Q-20). */
  const [deviceTypeId, setDeviceTypeId] = useState<string | null>(null);
  /** Máy ĐƯỢC NAT — chọn máy thì ô IP trong chỉ còn IP của chính máy đó. */
  const [targetId, setTargetId] = useState(rule?.internalDeviceId ?? '');
  const [targetTerm, setTargetTerm] = useState(rule?.internalDeviceCode ?? '');
  const [addingRouter, setAddingRouter] = useState(false);
  /** Ô nào đang mở hộp thêm dịch vụ — để lưu xong áp thẳng vào đúng ô đó. */
  const [addingService, setAddingService] = useState<'external' | 'internal' | null>(null);
  const [protocol, setProtocol] = useState<NatProtocol>(rule?.protocol ?? 'tcp');
  /**
   * Port ngoài giữ dạng DANH SÁCH CHIP, không phải một chuỗi.
   *
   * Một rule trong DB chỉ mang một khoảng port, nhưng việc thật là "mở 8080, 8443 và
   * 5060-5070 cho cùng một máy, cùng một lý do". Gõ một lần, bấm Lưu ra ba dòng dùng chung
   * mọi thứ còn lại — không phải mở form ba lần, gõ lại router / IP trong / ai dùng / lý do
   * ba lượt rồi sai một chỗ là ba dòng lệch nhau.
   *
   * SỬA thì cắt về đúng một khoảng (`max={1}`): "sửa" là đổi một dòng đang có, còn tách nó
   * thành ba dòng là chuyện khác hẳn và phải đi qua nút Thêm rule cho rõ ràng.
   */
  const [ports, setPorts] = useState<PortChip[]>(() =>
    rule ? chipsFromValue(rule.externalPorts) : [],
  );
  const [internalIp, setInternalIp] = useState(rule?.internalIp ?? '');
  const [internalPort, setInternalPort] = useState(String(rule?.internalPort ?? ''));
  const [usedBy, setUsedBy] = useState(rule?.usedBy ?? '');
  const [reason, setReason] = useState(rule?.reason ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [note, setNote] = useState(rule?.note ?? '');
  const [error, setError] = useState<string | null>(null);
  /** Sửa = một khoảng; thêm mới = bao nhiêu khoảng cũng được (mỗi khoảng ra một dòng). */
  const maxPorts = rule ? 1 : Number.POSITIVE_INFINITY;
  /* Nhiều chip = nhiều lượt gọi nối tiếp; giữa hai lượt `isPending` tụt về false, không khoá
     thêm thì nút Lưu nhấp nháy mở ra và bấm phát nữa là ghi trùng cả cụm. */
  const [saving, setSaving] = useState(false);
  const busy = saving;

  const lists = useCatalogLists();

  /**
   * NET-041 (Q-14) + Q-20: ô Router lọc theo LOẠI, mặc định các loại mang cờ "Router/Firewall"
   * — bản không lọc bày mục đầu là camera, và chọn nhầm camera làm router là dữ liệu sai mà
   * không ai phát hiện. Nhưng NAT ở PMH còn đặt trên Firewall, Core… nên người dùng tự bật thêm
   * loại (chip, chọn nhiều) hoặc "Tất cả loại"; chọn máy ngoài loại Router chỉ cảnh báo.
   *
   * Chưa loại nào mang cờ (danh mục chưa khai) thì mặc định là mọi loại, kèm lời nhắc — một ô
   * Router rỗng trơn là người dùng kết luận kho không có router nào.
   */
  const deviceTypes = lists.data?.deviceTypes;
  const typeFilter = useDeviceTypeFilter(deviceTypes);
  const hasRouterType = (deviceTypes ?? []).some((type) => type.isRouter);
  const notRouter = deviceId !== '' && hasRouterType && !isRouterType(deviceTypes, deviceTypeId);

  /**
   * IP của máy đích. Chọn máy xong thì ô "IP trong" chỉ còn IP của chính máy đó — hết cảnh
   * gõ tay một địa chỉ không thuộc máy nào (thứ `validateNatRule` đang phải chặn ở tầng sau).
   */
  const targetIps = useQuery({
    queryKey: ['ipam', 'device-addresses', targetId],
    enabled: targetId !== '',
    queryFn: () =>
      apiFetch<{ id: string; address: string; usedBy: string | null; status: IpStatus }[]>(
        `/api/v1/ipam/devices/${targetId}/addresses`,
      ),
  });

  const departments = useMemo(
    () =>
      (lists.data?.departments ?? [])
        .filter((department) => department.active)
        .map((department) => department.name),
    [lists.data],
  );

  const services = useMemo(
    () => (lists.data?.servicePorts ?? []).filter((service) => service.active),
    [lists.data],
  );

  /**
   * Áp một dịch vụ vào ô port — port ngoài kéo theo cả giao thức, vì đó là ý nghĩa của nó.
   *
   * Chọn dịch vụ giờ là THÊM một chip chứ không ghi đè ô: chọn "HTTPS" rồi chọn tiếp "RDP"
   * mà mất cái đầu là đúng cái bẫy khiến người ta tưởng ô này chỉ chứa được một thứ.
   */
  const applyService = (service: ServicePortRow, field: 'external' | 'internal') => {
    if (field === 'external') {
      const value =
        service.portFrom === service.portTo
          ? String(service.portFrom)
          : `${service.portFrom}-${service.portTo}`;
      /*
       * Đang SỬA (đã đủ một khoảng) thì KHÔNG đụng gì cả — kể cả giao thức.
       *
       * Nếu vẫn `setProtocol(...)` ở đây, người dùng mở hộp Sửa, chọn HTTPS, thấy giao thức
       * nhảy sang TCP mà con số port đứng im, và tin rằng port đã đổi theo. Im lặng một nửa
       * còn tệ hơn im lặng hẳn.
       */
      if (ports.length >= maxPorts) return;
      const parsed = parsePortChip(value, ports);
      /*
       * Khoảng này đã có rồi thì KHÔNG đụng gì cả — kể cả giao thức.
       *
       * Cùng lỗi "im lặng một nửa" với chế độ sửa: gõ tay 443, đổi giao thức sang UDP, rồi
       * chọn "HTTPS" (443/TCP) trong danh mục — danh sách port đứng im mà giao thức lặng lẽ
       * nhảy về TCP. Người dùng không bấm gì thêm và không hề biết.
       */
      if (!parsed.chip) return;
      setPorts([...ports, parsed.chip]);
      setProtocol(service.protocol);
    } else {
      // Port TRONG là một số duy nhất (đích của chuyển tiếp), nên lấy đầu dải.
      setInternalPort(String(service.portFrom));
    }
  };

  /*
   * Hai luật của ô "IP trong" nằm ở `checkInternalIp` (hàm thuần, có test bảng dữ liệu):
   * phải có địa chỉ, và địa chỉ phải thuộc chính máy đích đang chọn.
   */
  const ipCheck = checkInternalIp({
    internalIp,
    targetId,
    targetIps: (targetIps.data ?? []).map((ip) => ip.address),
  });
  const check = useFormErrors({
    deviceId: !deviceId && t('formErrors.requiredPick'),
    ports: ports.length === 0 && t('nat.portRequired'),
    internalPort: !internalPort.trim() && t('formErrors.required'),
    internalIp: ipCheck.reason && t(`nat.${ipCheck.reason}`),
    usedBy: !usedBy.trim() && t('formErrors.required'),
    reason: (!reason.trim() && t('formErrors.required')) || secretTextRule(t, reason),
    note: secretTextRule(t, note),
  });

  const save = useApiMutation<Record<string, unknown>, { warnings?: string[] }>(
    rule ? `/api/v1/ipam/nat/${rule.id}` : '/api/v1/ipam/nat',
    { method: rule ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <>
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={960}
      title={
        rule
          ? t('common.titleOf', {
              action: t('nat.edit'),
              subject: `${protocolLabel(rule.protocol, t)} ${rule.externalPorts}`,
            })
          : t('nat.add')
      }
      footer={
        <>
          <DialogCancel>
            {t('common.cancel')}
          </DialogCancel>
          <button type="submit" form="nat-form" className="btn primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      {/*
        Ba khối theo ĐÚNG đường đi của một gói tin: vào từ đâu → chuyển tới đâu → vì sao mở.
        Port ngoài và Port trong luôn phải đọc cùng nhau nên đứng chung một khối; xếp thành
        một dây ô dọc thì IP trong chen vào giữa hai thứ ấy.
      */}
      <form
        id="nat-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          void (async () => {
            setSaving(true);
            const shared = {
              deviceId,
              protocol,
              internalIp: internalIp.trim(),
              internalPort: Number(internalPort),
              usedBy: usedBy.trim(),
              reason: reason.trim(),
              enabled,
              note: note.trim(),
            };
            const warnings: string[] = [];
            const failures: string[] = [];
            /** Khoảng đã ghi xong — bỏ khỏi danh sách nếu phải giữ hộp lại. */
            const written: string[] = [];
            let created = 0;
            /* Nối tiếp chứ không song song: luật chống chồng port phía API xét dòng đang có
               trong DB, bắn cùng lúc thì hai chip chồng nhau có thể cùng lọt qua. */
            for (const chip of ports) {
              try {
                const result = await save.mutateAsync({
                  ...shared,
                  externalPorts: chip.value,
                });
                created += 1;
                written.push(chip.value);
                warnings.push(...(result?.warnings ?? []));
              } catch (err) {
                // Một khoảng hỏng KHÔNG được nuốt mất mấy khoảng đã ghi xong — nói rõ khoảng
                // nào hỏng vì sao, phần còn lại vẫn nằm trong sổ.
                failures.push(
                  t('nat.portFailed', { port: chip.value, reason: errorMessage(err) }),
                );
              }
            }
            setSaving(false);
            if (created === 0) {
              setError(failures.join(' '));
              return;
            }
            /*
             * Hỏng một phần thì GIỮ HỘP LẠI, chỉ bỏ đi những khoảng đã ghi xong.
             *
             * Đóng hộp là mất trắng router, máy đích, IP, lý do và mấy khoảng còn lại — người
             * dùng phải gõ lại từ đầu chỉ vì một khoảng đụng rule cũ. Toast cảnh báo trôi qua
             * trong vài giây, còn cái form thì đã biến mất.
             */
            if (failures.length > 0) {
              setPorts((current) => current.filter((chip) => !written.includes(chip.value)));
              setError(failures.join(' '));
              // Cảnh báo của những dòng ĐÃ ghi vẫn phải tới nơi.
              onPartial({ created, warnings });
              return;
            }
            onSaved({ created, warnings });
          })();
        }}
      >
        {check.summary}
        <FormSection title={t('nat.sectionExternal')} columns={4}>
          {/* MỘT ô chọn router; lọc loại là dải chip ngay dưới nó chứ không phải trường riêng —
              lọc nhầm loại thì chip đang bật nằm ngay đó để gỡ, không phải đoán vì sao rỗng. */}
          <Field
            label={t('nat.router')}
            required
            hint={t('nat.routerHint')}
            htmlFor="nat-router"
            error={check.error('deviceId')}
          >
            {/* Field chỉ tự nối id/mô tả/lỗi khi nó có ĐÚNG MỘT đứa con — ở đây có thêm dải chip
                lọc loại, nên nối tay theo đúng quy ước id của Field. */}
            {/* Danh sách mở sẵn (không chờ gõ): ô trắng thì người dùng kết luận hệ thống hỏng
                thay vì thấy ngay là chưa có router và bấm "Thêm router mới". Chờ danh mục loại:
                hỏi sớm thì camera đứng đầu danh sách rồi mới co lại. Máy đã thanh lý không dựng
                được rule NAT (API chặn) nên ô chọn chỉ bày máy còn dùng được. */}
            <DeviceCombobox
              id="nat-router"
              aria-describedby={
                check.error('deviceId') ? 'nat-router-error nat-router-hint' : 'nat-router-hint'
              }
              aria-invalid={check.error('deviceId') ? true : undefined}
              placeholder={t('nat.routerSearch')}
              ariaLabel={t('nat.router')}
              value={{ deviceId, term: deviceTerm }}
              onChange={(next) => {
                setDeviceTerm(next.term);
                setDeviceId(next.deviceId);
                setDeviceTypeId(next.device?.deviceTypeId ?? null);
              }}
              typeIds={typeFilter.value}
              ready={!lists.isPending}
              /* Router chưa có trong kho thì thêm NGAY TẠI ĐÂY. Bắt người dùng thoát ra,
                 sang màn Thiết bị, khai xong rồi quay lại gõ lại cả form NAT là ba lần
                 chuyển màn cho một việc — và form đang dở thì mất trắng. */
              action={{ label: t('nat.addRouter'), onClick: () => setAddingRouter(true) }}
            />
            {notRouter ? (
              <span className="field-hint warn-text">{t('deviceTypeFilter.notRouter')}</span>
            ) : null}
            <DeviceTypeFilter
              types={deviceTypes}
              value={typeFilter.value}
              onChange={typeFilter.setValue}
            />
            {hasRouterType || !lists.data ? null : (
              <span className="field-hint muted">
                {t('nat.routerNoType')}{' '}
                {/* Tab mới: rời trang ở đây là mất trắng form NAT đang gõ dở. */}
                <Link
                  to={`${PATHS.adminCatalog}?tab=device_type`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('nat.routerNoTypeLink')}
                </Link>
              </span>
            )}
          </Field>

          {/*
            Giao thức đứng CẠNH router, không lọt giữa ô Port ngoài: nó áp cho CẢ rule (cả port
            ngoài lẫn port trong), đặt dưới port ngoài là trông như chỉ thuộc riêng port ngoài.
            Chọn dịch vụ trong danh mục thì nó tự theo; gõ port tay thì chọn ở đây — bỏ hẳn thì
            port gõ tay luôn mặc định TCP, sai âm thầm với mấy dịch vụ UDP như VPN.
          */}
          <Field label={t('nat.protocol')}>
            {/* `catalog.protocolBoth`, KHÔNG phải một khoá riêng của `nat`: ô chọn cổng dịch vụ
                trong form đọc đúng khoá ấy, và hai nhãn khác chữ cho cùng một giao thức là thứ
                người dùng đọc ra thành hai lựa chọn khác nhau. */}
            <SegmentedRadio<NatProtocol>
              label={t('nat.protocol')}
              value={protocol}
              onChange={setProtocol}
              options={PROTOCOLS.map((item) => ({ value: item, label: protocolLabel(item, t) }))}
            />
          </Field>

          {/* Hai ô port đứng CẠNH nhau: "ngoài 8080 dẫn vào trong 80" là một câu đọc ngang,
              tách hai hàng thì phải nhớ số bên trên trong lúc đọc số bên dưới. Chế độ sửa chỉ
              còn MỘT lời nhắc (ngay dưới chip), không lặp thêm một câu gần giống ở hint. */}
          <Field
            label={t('nat.external')}
            required
            tip={rule ? undefined : t('nat.externalHint')}
            htmlFor="nat-external"
            error={check.error('ports')}
          >
            <PortChipsField
              chips={ports}
              onChange={setPorts}
              max={maxPorts}
              disabled={busy}
              inputId="nat-external"
            />
            {/* Đủ khoảng rồi (chế độ sửa) thì ẩn hẳn ô chọn dịch vụ: một điều khiển bấm vào
                mà không xảy ra gì là thứ người dùng sẽ bấm vài lần rồi nghĩ máy hỏng. */}
            {ports.length >= maxPorts ? null : (
              <ServicePortPicker
                services={services}
                pending={lists.isPending}
                label={t('nat.external')}
                onPick={(service) => applyService(service, 'external')}
                onAdd={() => setAddingService('external')}
              />
            )}
          </Field>

          <Field
            label={t('nat.internalPort')}
            required
            htmlFor="nat-internal-port"
            error={check.error('internalPort')}
          >
            <input
              id="nat-internal-port"
              className="inp mono"
              required
              inputMode="numeric"
              placeholder={t('nat.phExternalPorts')}
              value={internalPort}
              onChange={(e) => setInternalPort(e.target.value)}
            />
            <ServicePortPicker
              services={services}
              pending={lists.isPending}
              label={t('nat.internalPort')}
              onPick={(service) => applyService(service, 'internal')}
              onAdd={() => setAddingService('internal')}
            />
          </Field>
        </FormSection>

        <FormSection title={t('nat.sectionInternal')} columns={2}>
          {/*
            MÁY ĐÍCH — không có ô này thì sổ chỉ ghi "dẫn tới 172.16.10.5" mà không nói
            172.16.10.5 là máy nào. Ba thứ trong form là ba câu khác nhau, không trùng nhau:
              Router   = con nào THỰC HIỆN NAT (Draytek)
              Máy đích = con nào ĐƯỢC NAT (camera, NAS, máy chủ)  ← ô này
              Mở cho ai = NGƯỜI/bộ phận hưởng dịch vụ (câu auditor hỏi)
          */}
          <Field label={t('nat.target')} tip={t('nat.targetHint')}>
            <DeviceCombobox
              placeholder={t('nat.targetSearch')}
              ariaLabel={t('nat.target')}
              value={{ deviceId: targetId, term: targetTerm }}
              onChange={(next) => {
                setTargetTerm(next.term);
                setTargetId(next.deviceId);
                if (next.device) setInternalIp('');
              }}
            />
          </Field>

          <Field
            label={t('nat.internalIp')}
            required
            htmlFor="nat-internal-ip"
            error={check.error('internalIp')}
          >
            {targetId && (targetIps.isLoading || targetIps.isError) ? (
              /*
               * ĐANG TẢI danh sách IP của máy vừa chọn — chưa biết máy đó có IP hay không.
               * Rơi thẳng về ô gõ tay ở đây là sai hai lần: nó bày ra dòng "máy này chưa có
               * hồ sơ IP nào" trong khi câu trả lời chưa về, và nó mở đúng cái cửa gõ tay một
               * địa chỉ THUỘC MÁY KHÁC — rule sẽ lặng lẽ ghi về máy kia, vì máy đích của rule
               * suy ra từ IP chứ không từ ô chọn này.
               */
              <Select
                id="nat-internal-ip"
                value=""
                disabled
                ariaLabel={t('nat.internalIp')}
                placeholder={t(targetIps.isError ? 'nat.targetIpsError' : 'common.loading')}
                options={[]}
                onChange={() => {}}
              />
            ) : targetId && (targetIps.data ?? []).length > 0 ? (
              // Đã chọn máy thì chỉ còn IP CỦA CHÍNH MÁY ĐÓ — hết cảnh gõ tay một địa chỉ
              // không thuộc máy nào rồi bị API từ chối ở bước cuối.
              <Select
                id="nat-internal-ip"
                value={internalIp}
                ariaLabel={t('nat.internalIp')}
                placeholder={t('nat.pickIp')}
                /*
                 * Endpoint trả MỌI trạng thái vòng đời, chỉ lọc bản ghi đã hủy. Một hồ sơ
                 * đang TRỐNG mà còn mang `device_id` lọt vào đây trông y hệt một IP đang cấp —
                 * và người khai chĩa một rule NAT mới vào một địa chỉ sổ IP nói là không có
                 * chủ. Vẫn CHO chọn (sổ IP có thể chưa kịp cập nhật), nhưng phải NÓI RA.
                 */
                options={(targetIps.data ?? []).map((ip) => ({
                  value: ip.address,
                  label: [
                    ip.address,
                    ip.status === 'assigned' ? null : t(STATUS_KEY[ip.status]),
                    ip.usedBy,
                  ]
                    .filter(Boolean)
                    .join(' — '),
                }))}
                onChange={setInternalIp}
              />
            ) : (
              <>
                <input
                  id="nat-internal-ip"
                  className="inp mono"
                  required
                  placeholder={t('nat.phInternalIp')}
                  value={internalIp}
                  onChange={(e) => setInternalIp(e.target.value)}
                />
                {targetId ? (
                  <span className="field-hint muted">{t('nat.targetNoIp')}</span>
                ) : (
                  <IpBookHint ip={internalIp} />
                )}
              </>
            )}
          </Field>
        </FormSection>

        {/* Khối này là LÝ DO cuốn sổ tồn tại — nên hai ô đầu bắt buộc, không phải tùy chọn. */}
        <FormSection title={t('nat.sectionWhy')} columns={4}>
          <Field
            label={t('nat.usedBy')}
            required
            hint={t('nat.usedByHint')}
            error={check.error('usedBy')}
          >
            {/* Cùng danh mục Bộ phận với ô "ai đang dùng" của hồ sơ IP — hai chỗ trả lời cùng
                một câu, viết lệch nhau thì tra chéo không ra. */}
            <SuggestInput
              value={usedBy}
              onChange={setUsedBy}
              options={departments}
              placeholder={t('nat.usedByPlaceholder')}
              ariaLabel={t('nat.usedBy')}
            />
          </Field>

          {/* Ô tick và tên của nó CÙNG HÀNG ("☑ Đang dùng"), câu giải thích là mô tả bên dưới —
              nhãn đứng trên còn câu gợi ý làm tên ô tick thì mắt và trình đọc màn hình đọc hai
              thứ khác nhau. */}
          <div className="field">
            <label className="row" style={{ gap: 'var(--space-3)' }}>
              <input
                type="checkbox"
                checked={enabled}
                aria-describedby="nat-enabled-hint"
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="lbl-t">{t('nat.enabled')}</span>
            </label>
            <span className="field-hint muted" id="nat-enabled-hint">
              {t('nat.enabledHint')}
            </span>
          </div>

          <Field
            label={t('nat.reason')}
            required
            hint={t('nat.reasonHint')}
            htmlFor="nat-reason"
            span={2}
            error={check.error('reason')}
          >
            <textarea
              id="nat-reason"
              className="inp"
              rows={2}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {/* Ghi chú kỹ thuật (số phiếu yêu cầu, giới hạn IP nguồn trên router…) — API đã nhận
              và dữ liệu import đã có, form không có ô thì không ai sửa được nó. */}
          <Field
            label={t('nat.note')}
            tip={t('nat.noteHint')}
            htmlFor="nat-note"
            span={2}
            error={check.error('note')}
          >
            <textarea
              id="nat-note"
              className="inp"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </FormSection>

        {/*
          Giấy tờ (ảnh cấu hình router, email nhà mạng xác nhận mở port) chỉ có khi SỬA: rule
          chưa tồn tại thì chưa có id để gắn. Lịch sử KHÔNG nhúng ở đây — menu ⋮ của dòng đã có
          mục "Lịch sử", nhúng thêm vào hộp Sửa chỉ làm hộp dài gấp đôi cho một thứ không sửa được.
        */}
        {rule ? (
          <>
            {/* Panel này GHI THẲNG, không nằm trong lượt Lưu của form — trong hộp thoại CÓ
                nút Hủy thì điều đó không hiển nhiên, nên nói ra ở nút (i) cạnh tiêu đề. */}
            <FormSection
              title={t('attachments.title')}
              titleTip={t('attachments.liveTip')}
              columns={1}
            >
              <AttachmentPanel
                ownerType="nat_rule"
                ownerId={rule.id}
                csrfToken={csrfToken}
                canEdit={!busy}
              />
            </FormSection>
          </>
        ) : null}

        {/* Nói TRƯỚC khi bấm Lưu là sẽ ghi ra mấy dòng — sau đó mới biết thì đã muộn. */}
        {ports.length > 1 ? (
          <p className="alert">{t('nat.willCreate', { count: ports.length })}</p>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>

    {/* Router chưa có trong kho: khai bằng ĐÚNG hộp "Thêm thiết bị" (AD-15), rồi chọn luôn
        cái vừa tạo. Form NAT đang dở vẫn nguyên vẹn phía sau. */}
    {addingRouter ? (
      <DeviceForm
        device={null}
        presetDeviceTypeId={typeFilter.value[0]}
        csrfToken={csrfToken}
        onClose={() => setAddingRouter(false)}
        onSaved={(result) => {
          setAddingRouter(false);
          setDeviceId(result.device.id);
          setDeviceTerm(result.device.code);
          setDeviceTypeId(result.device.deviceTypeId);
          void queryClient.invalidateQueries({ queryKey: ['devices'] });
        }}
      />
    ) : null}

    {/* Dịch vụ mới: cũng ĐÚNG hộp của màn Danh mục, không dựng bản rút gọn thứ hai. */}
    {addingService ? (
      <CatalogForm
        entity="service_port"
        row={null}
        csrfToken={csrfToken}
        onClose={() => setAddingService(null)}
        onSaved={(saved) => {
          applyService(saved as ServicePortRow, addingService);
          setAddingService(null);
          void queryClient.invalidateQueries({ queryKey: ['catalog'] });
        }}
      />
    ) : null}
    </>
  );
}

/** Gỡ rule kèm lý do: "port 8080 đóng ngày nào, ai đóng, vì sao" sẽ có người hỏi. */
function RemoveDialog({
  rule,
  csrfToken,
  onClose,
  onDone,
}: {
  rule: NatRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({ reason: reasonRule(t, reason) });

  const remove = useApiMutation<{ reason: string }, unknown>(`/api/v1/ipam/nat/${rule.id}`, {
    method: 'DELETE',
    csrfToken,
    refreshMe: false,
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!remove.isPending}
      maxWidth={480}
      title={t('nat.removeTitle', { ports: `${protocolLabel(rule.protocol, t)} ${rule.externalPorts}` })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="nat-remove-form"
            className="btn danger"
            disabled={remove.isPending}
          >
            {remove.isPending ? t('common.working') : t('nat.remove')}
          </button>
        </>
      }
    >
      <form
        id="nat-remove-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          remove.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t('nat.removeHint')}</p>
        <Field
          label={t('nat.removeReason')}
          required
          htmlFor="nat-remove-reason"
          error={check.error('reason')}
        >
          <input
            id="nat-remove-reason"
            className="inp"
            required
            minLength={3}
            placeholder={t('nat.removeReasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * Lịch sử của MỘT rule NAT.
 *
 * Tách thành component riêng để truy vấn chỉ chạy khi hộp Lịch sử thật sự mở ra.
 */
function NatHistory({ ruleId }: { ruleId: string }) {
  const { t } = useTranslation();
  const history = useQuery({
    queryKey: ['ipam', 'nat', ruleId, 'history'],
    queryFn: () => apiFetch<NatHistoryRow[]>(`/api/v1/ipam/nat/${ruleId}/history`),
  });

  if (history.isLoading) return <Loading />;
  if (history.isError) return <LoadError error={history.error} onRetry={() => void history.refetch()} />;
  return <HistoryPanel entries={toNatHistory(history.data ?? [], t)} />;
}

/**
 * Gõ tay IP trong (chưa chọn máy đích): tra sổ IP ngay để nói IP đó của máy nào, hoặc cảnh báo
 * nó CHƯA có trong sổ — rule trỏ vào một IP ngoài sổ thì sổ NAT mất liên kết với máy. Vẫn cho
 * lưu: sổ IP có thể chưa kịp khai, và chặn ở đây là đẩy người ta về ghi chép tay.
 */
function IpBookHint({ ip }: { ip: string }) {
  const { t } = useTranslation();
  const address = ip.trim();
  const valid = parseIpv4(address) !== null;
  const hits = useQuery({
    queryKey: ['ipam', 'addresses', 'search', address],
    enabled: valid,
    queryFn: () =>
      apiFetch<IpSearchHit[]>(`/api/v1/ipam/addresses?limit=5&search=${encodeURIComponent(address)}`),
  });
  /* Dải chứa IP này (nếu có) — để lối "Cấp IP này trong sổ" mở đúng dải, đúng dòng. */
  const subnets = useQuery({
    queryKey: ['ipam', 'subnets', 'nat-hint'],
    enabled: valid,
    queryFn: () => apiFetch<{ id: string; cidr: string }[]>('/api/v1/ipam/subnets'),
  });
  if (!valid || !hits.data) return null;
  const hit = hits.data.find((row) => row.address === address && row.status === 'assigned');
  if (!hit) {
    const home = subnetOf(address, subnets.data ?? []);
    return (
      <span className="field-hint warn-text" role="note">
        {t('nat.ipNotInBook', { ip: address })}
        {/* Mở TAB MỚI: rời form NAT đang gõ dở là mất sạch những gì đã điền. */}
        {home ? (
          <>
            {' '}
            <a
              href={`${PATHS.subnet(home.id)}?ip=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noopener"
            >
              {t('nat.ipAssignNow')}
            </a>
          </>
        ) : null}
      </span>
    );
  }
  const owner = [hit.deviceCode, hit.usedBy].filter(Boolean).join(' · ');
  return (
    <span className="field-hint muted">
      {t('nat.ipInBook', { owner: owner || hit.subnetCidr })}
    </span>
  );
}
