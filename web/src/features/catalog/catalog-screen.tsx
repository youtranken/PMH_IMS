import { formatPhone } from '@/lib/phone-format';
import { PhoneLink } from '@/ui/phone-link';
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { CellNote } from '@/ui/cell-note';
import { DataTable, type MobileCard } from '@/ui/data-table';
import { sortQuery } from '@/lib/sort-query';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Dialog } from '@/ui/dialog';
import { HistoryPanel } from '@/ui/history-panel';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { useCatalogLists } from '@/ui/use-catalog-lists';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { RowActions, type RowAction, type RowPrimaryAction } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { CatalogForm } from './catalog-form';
import { CatalogImportDialog } from './catalog-import-dialog';
import { toCatalogHistory, type CatalogHistoryRow } from './catalog-history-entries';
import { devicesFilterOf, usageLinks, usageTotal } from './catalog-usage';
import {
  catalogLabel,
  portRangeLabel,
  IMPORTABLE_ENTITIES,
  type CabinetRow,
  type CatalogEntity,
  type CatalogLists,
  type CatalogRow,
  type DepartmentRow,
  type DeviceTypeRow,
  type IspProviderRow,
  type ServicePortRow,
  type SiteRow,
  type VendorRow,
} from '@/lib/catalog-types';

const DEFAULT_LIMIT = 20;

const TAB_KEYS: { key: CatalogEntity; labelKey: string; searchKey: string }[] = [
  { key: 'site', labelKey: 'catalog.tabSite', searchKey: 'catalog.searchSite' },
  { key: 'cabinet', labelKey: 'catalog.tabCabinet', searchKey: 'catalog.searchCabinet' },
  { key: 'device_type', labelKey: 'catalog.tabDeviceType', searchKey: 'catalog.searchDeviceType' },
  { key: 'vendor', labelKey: 'catalog.tabVendor', searchKey: 'catalog.searchVendor' },
  { key: 'department', labelKey: 'catalog.tabDepartment', searchKey: 'catalog.searchDepartment' },
  { key: 'isp_provider', labelKey: 'catalog.tabIspProvider', searchKey: 'catalog.searchIspProvider' },
  { key: 'service_port', labelKey: 'catalog.tabServicePort', searchKey: 'catalog.searchServicePort' },
];

/**
 * Cột đang sắp mặc định của mỗi tab — PHẢI khớp `CATALOG_SORT_DEFAULT` phía API
 * (`api/src/modules/catalog/catalog.service.ts`): site/cabinet theo `code`, loại/NCC
 * không có mã riêng nên theo `name`.
 */
const ENTITY_DEFAULT_SORT: Record<CatalogEntity, SortingState> = {
  site: [{ id: 'code', desc: false }],
  cabinet: [{ id: 'code', desc: false }],
  device_type: [{ id: 'name', desc: false }],
  vendor: [{ id: 'name', desc: false }],
  department: [{ id: 'name', desc: false }],
  isp_provider: [{ id: 'name', desc: false }],
  service_port: [{ id: 'name', desc: false }],
};

/*
 * Tab, ô tìm, trạng thái, site, trang, số dòng và cột sắp sống trên THANH ĐỊA CHỈ
 * (`useListUrlState`): F5, Back từ hồ sơ khác, hay gửi link "tab Tủ mạng, tìm HCM" cho đồng
 * nghiệp đều mở lại đúng chỗ đang xem. `tab` rỗng = Site.
 */
interface CatalogFilters extends Record<string, string> {
  tab: string;
  search: string;
  status: string;
  siteId: string;
}

const EMPTY_FILTERS: CatalogFilters = { tab: '', search: '', status: '', siteId: '' };

function entityOf(tab: string): CatalogEntity {
  return TAB_KEYS.some((item) => item.key === tab) ? (tab as CatalogEntity) : 'site';
}

/**
 * Ô chữ dài (địa chỉ · mô tả · cung cấp gì) — rút đúng MỘT dòng, bị cắt thì bấm để mở đủ câu.
 *
 * Bảy tab dùng chung một khung bảng, và cột chữ tự do là thứ duy nhất không có trần: một mô tả
 * ba dòng kéo cao cả hàng và bóp mọi cột còn lại. Ở ≤960px bảng gập thẻ dọc nên nó tự nhả ra.
 */
function note(value: string | null | undefined) {
  return <CellNote text={orDash(value)} />;
}

/** Số điện thoại bấm gọi được — cùng cách với hotline nhà mạng, hai tab cùng một khái niệm. */
function phoneLink(value: string | null | undefined) {
  return value ? <PhoneLink value={value} /> : '—';
}

const EMAIL_RE = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/;

/**
 * Ô "Email / người liên hệ" là chữ tự do; có email trong đó thì biến đúng đoạn email thành
 * `mailto:` để bấm là soạn thư, phần tên người vẫn là chữ.
 */
function contactText(value: string | null | undefined) {
  if (!value) return '—';
  const match = EMAIL_RE.exec(value);
  if (!match) return value;
  const before = value.slice(0, match.index);
  const after = value.slice(match.index + match[0].length);
  return (
    <>
      {before}
      <a href={`mailto:${match[0]}`}>{match[0]}</a>
      {after}
    </>
  );
}

/**
 * Cột riêng từng loại. `accessorKey` PHẢI trùng khóa whitelist `CATALOG_SORT_KEYS` phía API —
 * đó là tên cột gửi lên trong `?sort=`. Cột chỉ có `id` sẽ không có nút sắp: đúng ý với
 * `siteCode` của tủ mạng, giá trị đó lấy qua JOIN sang bảng site nên KHÔNG được sắp (AD-2) —
 * muốn xem theo site thì dùng bộ lọc Site.
 */
const ENTITY_COLUMNS: Record<
  CatalogEntity,
  (t: TFunction, siteName: (id: string) => string | undefined) => ColumnDef<CatalogRow, unknown>[]
> = {
  site: (t) => [
    {
      accessorKey: 'code',
      header: t('catalog.code'),
      cell: ({ row }) => <span className="mono">{(row.original as SiteRow).code}</span>,
    },
    {
      accessorKey: 'name',
      header: t('catalog.name'),
      cell: ({ row }) => (row.original as SiteRow).name,
    },
    {
      accessorKey: 'address',
      header: t('catalog.address'),
      cell: ({ row }) => note((row.original as SiteRow).address),
    },
  ],
  cabinet: (t, siteName) => [
    {
      accessorKey: 'code',
      header: t('catalog.code'),
      cell: ({ row }) => <span className="mono">{(row.original as CabinetRow).code}</span>,
    },
    {
      id: 'siteCode',
      header: t('catalog.site'),
      cell: ({ row }) => {
        const cabinet = row.original as CabinetRow;
        const name = siteName(cabinet.siteId);
        return (
          <>
            <span className="mono">{cabinet.siteCode}</span>
            {name ? <span className="cell-sub">{name}</span> : null}
          </>
        );
      },
    },
    {
      accessorKey: 'description',
      header: t('catalog.cabinetDescription'),
      cell: ({ row }) => note((row.original as CabinetRow).description),
    },
    {
      accessorKey: 'uHeight',
      header: t('catalog.uHeight'),
      meta: { className: 'num' },
      cell: ({ row }) => orDash((row.original as CabinetRow).uHeight),
    },
  ],
  device_type: (t) => [
    {
      accessorKey: 'name',
      header: t('catalog.name'),
      cell: ({ row }) => (row.original as DeviceTypeRow).name,
    },
    {
      accessorKey: 'hasPortMap',
      header: t('catalog.hasPortMap'),
      cell: ({ row }) => (
        <span className={`badge ${(row.original as DeviceTypeRow).hasPortMap ? 'ok' : 'muted'}`}>
          {t((row.original as DeviceTypeRow).hasPortMap ? 'common.yes' : 'common.no')}
        </span>
      ),
    },
    {
      accessorKey: 'isRouter',
      header: t('catalog.isRouter'),
      cell: ({ row }) => (
        <span className={`badge ${(row.original as DeviceTypeRow).isRouter ? 'ok' : 'muted'}`}>
          {t((row.original as DeviceTypeRow).isRouter ? 'common.yes' : 'common.no')}
        </span>
      ),
    },
    {
      accessorKey: 'description',
      header: t('catalog.description'),
      cell: ({ row }) => note((row.original as DeviceTypeRow).description),
    },
  ],
  vendor: (t) => [
    {
      accessorKey: 'name',
      header: t('catalog.name'),
      cell: ({ row }) => (row.original as VendorRow).name,
    },
    {
      accessorKey: 'supplies',
      header: t('catalog.supplies'),
      cell: ({ row }) => note((row.original as VendorRow).supplies),
    },
    {
      accessorKey: 'phone',
      header: t('catalog.phone'),
      cell: ({ row }) => phoneLink((row.original as VendorRow).phone),
    },
    {
      accessorKey: 'contact',
      header: t('catalog.contact'),
      cell: ({ row }) => contactText((row.original as VendorRow).contact),
    },
  ],
  department: (t) => [
    {
      accessorKey: 'name',
      header: t('catalog.name'),
      cell: ({ row }) => (row.original as DepartmentRow).name,
    },
    {
      accessorKey: 'description',
      header: t('catalog.description'),
      cell: ({ row }) => note((row.original as DepartmentRow).description),
    },
  ],
  isp_provider: (t) => [
    {
      accessorKey: 'name',
      header: t('catalog.name'),
      cell: ({ row }) => (row.original as IspProviderRow).name,
    },
    {
      accessorKey: 'hotline',
      header: t('catalog.hotline'),
      // Bấm gọi được: đứt cáp lúc 2 giờ sáng thì người ta cầm điện thoại, không cầm chuột.
      cell: ({ row }) => phoneLink((row.original as IspProviderRow).hotline),
    },
    {
      accessorKey: 'contact',
      header: t('catalog.contact'),
      cell: ({ row }) => contactText((row.original as IspProviderRow).contact),
    },
  ],
  service_port: (t) => [
    {
      accessorKey: 'name',
      header: t('catalog.name'),
      cell: ({ row }) => (row.original as ServicePortRow).name,
    },
    {
      accessorKey: 'protocol',
      header: t('catalog.protocol'),
      cell: ({ row }) => {
        const protocol = (row.original as ServicePortRow).protocol;
        return (
          <span className="badge muted plain">
            {protocol === 'both' ? t('catalog.protocolBoth') : protocol.toUpperCase()}
          </span>
        );
      },
    },
    {
      accessorKey: 'portFrom',
      header: t('catalog.port'),
      /* `num` (căn phải như mọi cột số) áp cho cả tiêu đề; `mono` CHỈ bọc giá trị — đặt `mono`
         ở meta thì tiêu đề "PORT" cũng thành chữ mono nhỏ lệch hẳn các cột khác. */
      meta: { className: 'num' },
      cell: ({ row }) => <span className="mono">{portRangeLabel(row.original as ServicePortRow)}</span>,
    },
    {
      accessorKey: 'description',
      header: t('catalog.description'),
      cell: ({ row }) => note((row.original as ServicePortRow).description),
    },
  ],
};

/**
 * Dòng 2 của thẻ gọn trên điện thoại: thuộc tính phụ nối bằng " · ", không nhãn — mỗi mục
 * một hàng nhãn–giá trị thì 19 loại thiết bị dài sáu màn hình.
 */
function mobileMeta(entity: CatalogEntity, row: CatalogRow, t: TFunction): string {
  const parts: (string | null | undefined)[] = (() => {
    switch (entity) {
      case 'site':
        return [(row as SiteRow).address];
      case 'cabinet': {
        const cabinet = row as CabinetRow;
        return [
          cabinet.uHeight != null ? `${cabinet.uHeight}U` : null,
          cabinet.description,
        ];
      }
      case 'device_type': {
        const type = row as DeviceTypeRow;
        return [
          type.hasPortMap ? t('catalog.hasPortMap') : null,
          type.isRouter ? t('catalog.isRouter') : null,
          type.description,
        ];
      }
      case 'vendor':
        return [(row as VendorRow).supplies, formatPhone((row as VendorRow).phone), (row as VendorRow).contact];
      case 'department':
        return [(row as DepartmentRow).description];
      case 'isp_provider':
        return [formatPhone((row as IspProviderRow).hotline), (row as IspProviderRow).contact];
      case 'service_port': {
        const port = row as ServicePortRow;
        return [
          port.protocol === 'both' ? t('catalog.protocolBoth') : port.protocol.toUpperCase(),
          portRangeLabel(port),
          port.description,
        ];
      }
    }
  })();
  return parts.filter(Boolean).join(' · ');
}

/** Tên dòng 1 của thẻ: mã với site/tủ (kèm tên site ở dòng dưới), tên với các loại còn lại. */
function mobileTitle(entity: CatalogEntity, row: CatalogRow): string {
  if (entity === 'site') return `${(row as SiteRow).code} — ${(row as SiteRow).name}`;
  return catalogLabel(entity, row);
}

/** Chữ "12 thiết bị" cho một con số dùng — dùng chung cho ô bảng, thẻ gọn và câu hỏi lại. */
function usageText(kind: string, count: number, t: TFunction): string {
  return t(`catalog.usage_${kind}`, { count, defaultValue: t('catalog.usage_other', { count }) });
}

/** "Đang dùng ở 12 thiết bị · 1 dải IP" — số nào màn đích lọc được thì bấm sang danh sách lọc sẵn. */
function UsageCell({ entity, row }: { entity: CatalogEntity; row: CatalogRow }) {
  const { t } = useTranslation();
  const links = usageLinks(entity, row);
  if (links.length === 0) return <span className="muted">{t('catalog.usageNone')}</span>;
  return (
    <span>
      {links.map((item, index) => (
        <span key={item.kind}>
          {index > 0 ? ' · ' : null}
          {item.href ? (
            <Link to={item.href}>{usageText(item.kind, item.count, t)}</Link>
          ) : (
            <span>{usageText(item.kind, item.count, t)}</span>
          )}
        </span>
      ))}
    </span>
  );
}

function usageSummary(entity: CatalogEntity, row: CatalogRow, t: TFunction): string {
  return usageLinks(entity, row)
    .map((item) => usageText(item.kind, item.count, t))
    .join(' · ');
}

/**
 * Quản trị danh mục (FR-004).
 * Q-12: mọi vai thêm và sửa được; ngừng dùng, xóa và nhập Excel chỉ SA/Admin. Chốt quyền thật
 * nằm ở `@Roles` phía API, đây chỉ là ẩn cho đỡ rối (AD-9).
 */
export function CatalogScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const url = useListUrlState<CatalogFilters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    searchKey: 'search',
  });
  const { page, limit, filters } = url;
  const entity = entityOf(filters.tab);
  /* Không có `sort` trên URL = cột mặc định của TAB đang xem (mỗi tab một cột mặc định). */
  const sorting: SortingState = url.sorting.key
    ? [{ id: url.sorting.key, desc: url.sorting.desc }]
    : ENTITY_DEFAULT_SORT[entity];
  const siteId = entity === 'cabinet' ? filters.siteId : '';

  const [editing, setEditing] = useState<{ row: CatalogRow | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [historyOf, setHistoryOf] = useState<{ id: string; name: string } | null>(null);

  const canManage = me.role === 'sa' || me.role === 'admin';
  const csrfToken = me.csrfToken;
  const importable = (IMPORTABLE_ENTITIES as readonly string[]).includes(entity);

  /* Tên site cho cột "Thuộc site" và ô lọc Site của tab Tủ mạng, và số mục trên nhãn từng tab
     (ADM-031): người mới nhìn thanh tab là biết bảy nhóm nào đã khai, nhóm nào còn trống. Cùng
     một truy vấn danh mục nền mà mọi form đã dùng — không thêm lượt hỏi riêng. */
  const lists = useCatalogLists();
  const siteNames = useMemo(
    () => new Map((lists.data?.sites ?? []).map((site) => [site.id, site.name])),
    [lists.data],
  );

  const rows = useQuery({
    queryKey: ['catalog', entity, page, limit, filters.search, filters.status, siteId, sorting],
    // Đổi trang/từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới — nhưng CHỈ trong cùng một loại
    // danh mục: sang tab khác mà giữ dòng cũ là vẽ tủ mạng dưới cột của nhà cung cấp.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === entity ? keepPreviousData(previous) : undefined,
    queryFn: () =>
      apiFetch<{ items: CatalogRow[]; total: number }>(
        `/api/v1/catalog/${entity}?${buildQuery(page, limit, filters.search, filters.status, siteId, sorting)}`,
      ),
  });
  useClampPage(url, rows.data?.total);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['catalog'] });

  const setActive = useApiMutation<{ id: string; active: boolean }, unknown>(
    (input) => `/api/v1/catalog/${entity}/${input.id}/active`,
    { method: 'PATCH', csrfToken, refreshMe: false, body: (input) => ({ active: input.active }) },
  );
  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/catalog/${entity}/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  const items = rows.data?.items ?? [];

  /* Bộ lọc "thật" của tab — `tab` không tính: đổi tab không phải là lọc. */
  const activeCount = [filters.search, filters.status, siteId].filter(Boolean).length;
  const clearFilters = () => {
    url.clearFilters();
    if (filters.tab) url.setFilter('tab', filters.tab);
  };

  const switchTab = (key: string) => {
    // Sang tab khác: bỏ từ khoá, site, trang và cột sắp của tab trước (cột đó có thể không tồn
    // tại ở tab mới); GIỮ bộ lọc trạng thái — "chỉ xem đã ngừng dùng" để dọn là việc xuyên tab.
    const status = filters.status;
    url.clearFilters();
    url.setFilter('tab', key === 'site' ? '' : key);
    if (status) url.setFilter('status', status);
    url.setSorting({ key: '', desc: false });
  };

  const primaryFor = (catalogRow: CatalogRow): RowPrimaryAction => ({
    label: t('catalog.edit'),
    ariaLabel: t('common.editOf', { subject: catalogLabel(entity, catalogRow) }),
    onClick: () => setEditing({ row: catalogRow }),
  });

  const actionsFor = (catalogRow: CatalogRow): RowAction[] => {
    const name = catalogLabel(entity, catalogRow);
    const devices = devicesFilterOf(entity, catalogRow);
    return [
      {
        key: 'history',
        label: t('catalog.history'),
        onSelect: () => setHistoryOf({ id: catalogRow.id, name }),
      },
      ...(devices
        ? [
            {
              key: 'devices',
              label: t('catalog.viewDevices'),
              onSelect: () => navigate(`${PATHS.devices}?${devices}`),
            },
          ]
        : []),
      ...(canManage
        ? [
            {
              key: 'audit',
              label: t('catalog.auditLog'),
              onSelect: () =>
                navigate(`${PATHS.adminAuditLog}?objectId=${encodeURIComponent(catalogRow.id)}`),
            },
            ...manageItems(catalogRow, name),
          ]
        : []),
    ];
  };

  const columns = useMemo<ColumnDef<CatalogRow, unknown>[]>(() => {
    const entityColumns = ENTITY_COLUMNS[entity](t, (id) => siteNames.get(id));
    const statusColumn: ColumnDef<CatalogRow, unknown> = {
      accessorKey: 'active',
      header: t('catalog.status'),
      cell: ({ row }) => (
        <span className={`badge ${row.original.active ? 'ok' : 'danger'}`}>
          {t(row.original.active ? 'catalog.active' : 'catalog.inactive')}
        </span>
      ),
    };
    const actionsColumn: ColumnDef<CatalogRow, unknown> = {
      id: 'actions',
      header: t('common.actions'),
      meta: { className: 'col-center' },
      cell: ({ row }) => (
        <RowActions
          primary={primaryFor(row.original)}
          label={t('common.actionsOf', { subject: catalogLabel(entity, row.original) })}
          subject={catalogLabel(entity, row.original)}
          items={actionsFor(row.original)}
        />
      ),
    };
    const usageColumn: ColumnDef<CatalogRow, unknown> = {
      id: 'usage',
      header: t('catalog.usageColumn'),
      enableSorting: false,
      cell: ({ row }) => <UsageCell entity={entity} row={row.original} />,
    };
    return entity === 'service_port'
      ? [...entityColumns, statusColumn, actionsColumn]
      : [...entityColumns, usageColumn, statusColumn, actionsColumn];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, t, canManage, siteNames]);

  const mobileCard: MobileCard<CatalogRow> = {
    title: (row) => mobileTitle(entity, row),
    // Trạng thái chỉ hiện khi mục đã ngừng dùng — "Đang dùng" gần như dòng nào cũng giống nhau.
    badge: (row) =>
      row.active ? null : <span className="badge danger">{t('catalog.inactive')}</span>,
    subtitle: (row) =>
      entity === 'cabinet' ? siteNames.get((row as CabinetRow).siteId) ?? null : null,
    meta: (row) =>
      [mobileMeta(entity, row, t), usageSummary(entity, row, t)].filter(Boolean).join(' · ') || null,
    actions: (row) => (
      <RowActions
        primary={primaryFor(row)}
        label={t('common.actionsOf', { subject: catalogLabel(entity, row) })}
        subject={catalogLabel(entity, row)}
        items={actionsFor(row)}
      />
    ),
  };

  /** Ngừng dùng / Xóa — chỉ SA/Admin (Q-12). */
  function manageItems(catalogRow: CatalogRow, name: string): RowAction[] {
    return [
      {
        key: 'active',
        label: t(catalogRow.active ? 'catalog.deactivate' : 'catalog.activate'),
        /* Ngừng dùng là lấy đi nhưng ĐẢO LẠI ĐƯỢC (`warn`, nhóm riêng); Xóa thì không (`danger`).
           Cùng màu đỏ đứng sát nhau thì hai việc khác hẳn hệ quả trông như một. */
        warn: catalogRow.active,
        ok: !catalogRow.active,
        onSelect: () => {
          void (async () => {
            const ok = await askConfirm({
              title: t('common.titleOf', {
                action: t(catalogRow.active ? 'catalog.deactivate' : 'catalog.activate'),
                subject: name,
              }),
              message:
                t(catalogRow.active ? 'catalog.confirmDeactivate' : 'catalog.confirmActivate', {
                  name,
                }) +
                (catalogRow.active && usageTotal(catalogRow) > 0
                  ? ' ' +
                    t('catalog.deactivateInUse', { usage: usageSummary(entity, catalogRow, t) })
                  : ''),
              danger: catalogRow.active,
              confirmLabel: t(catalogRow.active ? 'catalog.deactivate' : 'catalog.activate'),
            });
            if (!ok) return;
            setActive.mutate(
              { id: catalogRow.id, active: !catalogRow.active },
              {
                onSuccess: () => {
                  toast({
                    message: t(catalogRow.active ? 'catalog.deactivated' : 'catalog.activated', {
                      name,
                    }),
                  });
                  void refresh();
                },
                onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
              },
            );
          })();
        },
      },
      {
        key: 'delete',
        label: t('catalog.delete'),
        danger: true,
        /* Khóa ngoại chắc chắn chặn — nói trước thay vì để người dùng xác nhận rồi mới nhận 409.
           Sổ đếm hỏng thì `usage` rỗng và nút vẫn bấm được; khóa ngoại vẫn là hàng rào thật. */
        disabled: usageTotal(catalogRow) > 0,
        hint:
          usageTotal(catalogRow) > 0
            ? t('catalog.deleteInUse', { usage: usageSummary(entity, catalogRow, t) })
            : undefined,
        onSelect: () => {
          void (async () => {
            const ok = await askConfirm({
              title: t('common.titleOf', { action: t('catalog.delete'), subject: name }),
              message: t('catalog.confirmDelete', { name }),
              danger: true,
              confirmLabel: t('catalog.delete'),
            });
            if (!ok) return;
            remove.mutate(
              { id: catalogRow.id },
              {
                onSuccess: () => {
                  toast({ message: t('catalog.deleted') });
                  void refresh();
                },
                // Xóa mục đang được thiết bị dùng → API trả 409 kèm câu gợi ý "hãy ngừng
                // dùng"; hiện nguyên văn cho người dùng.
                onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
              },
            );
          })();
        },
      },
    ];
  }

  const kind = t(`catalog.noun${TAB_SUFFIX[entity]}`);

  return (
    <>
      <PageHeader
        title={t('catalog.title')}
        subtitle={t('catalog.subtitle')}
        actions={
          <>
            {/* Nhập Excel chỉ có nghĩa với bốn danh mục gốc, và chỉ SA/Admin (Q-12). File mẫu
                nằm TRONG hộp nhập — nó là bước con của việc nhập, không phải nút đầu trang. */}
            {/* Xuất đúng tab + bộ lọc đang xem — tờ in dán phòng máy (NCC, hotline nhà mạng). */}
            <ExportXlsxButton
              url={`/api/v1/catalog/${entity}/export?${exportQuery(filters.search, filters.status, siteId, sorting)}`}
              fileName={`danh-muc-${entity}.xlsx`}
            />
            {importable && canManage ? (
              <button type="button" className="btn hide-narrow" onClick={() => setImporting(true)}>
                {t('catalog.importExcel')}
              </button>
            ) : null}
            {/* Bề ngang tối thiểu cố định (`.catalog-add`): nhãn đổi theo tab ("Thêm site" →
                "Thêm nhà cung cấp") mà nút co giãn theo chữ thì cả cụm nút giật mỗi lần đổi tab. */}
            <button
              type="button"
              className="btn primary catalog-add"
              onClick={() => setEditing({ row: null })}
            >
              {t(`catalog.add${TAB_SUFFIX[entity]}`)}
            </button>
          </>
        }
      />

      <Tabs
        items={TAB_KEYS.map((tab) => ({
          key: tab.key,
          label: t(tab.labelKey),
          count: lists.data?.[LIST_OF[tab.key]]?.length,
        }))}
        value={entity}
        onChange={switchTab}
        ariaLabel={t('catalog.title')}
      />

      <TabPanel tabKey={entity}>
        <FilterBar
          search={url.searchInput}
          onSearchChange={url.setSearchInput}
          searchPlaceholder={t(TAB_KEYS.find((tab) => tab.key === entity)?.searchKey ?? 'common.search')}
          activeCount={activeCount}
          onClear={clearFilters}
        >
          {entity === 'cabinet' ? (
            <Select
              value={siteId}
              ariaLabel={t('catalog.siteFilter')}
              placeholder={t('catalog.siteAll')}
              failed={lists.isError}
              options={[
                { value: '', label: t('catalog.siteAll') },
                ...(lists.data?.sites ?? []).map((site) => ({
                  value: site.id,
                  label: `${site.code} — ${site.name}`,
                })),
              ]}
              onChange={(value) => url.setFilter('siteId', value)}
            />
          ) : null}
          <Select
            value={filters.status}
            ariaLabel={t('catalog.statusFilter')}
            placeholder={t('catalog.statusAll')}
            options={[
              { value: '', label: t('catalog.statusAll') },
              { value: 'active', label: t('catalog.active') },
              { value: 'inactive', label: t('catalog.inactive') },
            ]}
            onChange={(value) => url.setFilter('status', value)}
          />
        </FilterBar>

        {canManage ? null : <p className="muted catalog-member-hint">{t('catalog.memberHint')}</p>}

        {rows.isLoading ? (
          <Loading />
        ) : rows.isError ? (
          <LoadError error={rows.error} onRetry={() => void rows.refetch()} />
        ) : items.length === 0 && activeCount > 0 ? (
          /* Có bộ lọc mà không ra thì KHÔNG được nói "chưa khai mục nào": câu đó sai sự thật
             và đẩy người dùng đi nhập lại dữ liệu đang có. */
          <EmptyState
            title={
              filters.search
                ? t('catalog.emptyFiltered', { kind, q: filters.search })
                : t('catalog.emptyFilteredOnly', { kind })
            }
            action={
              <button type="button" className="btn" onClick={clearFilters}>
                {t(
                  filters.search && activeCount === 1
                    ? 'catalog.clearSearch'
                    : 'catalog.clearAllFilters',
                )}
              </button>
            }
          />
        ) : (
          <>
            <DataTable
              data={items}
              columns={columns}
              emptyText={t(importable && canManage ? 'catalog.emptyHint' : 'catalog.emptyHintManual')}
              stackOnMobile
              mobileCard={mobileCard}
              rowClassName={(row) => (row.active ? '' : 'row-muted')}
              manualSorting
              sorting={sorting}
              onSortingChange={(updater) => {
                const next = typeof updater === 'function' ? updater(sorting) : updater;
                const first = next[0];
                // Hook tự bỏ `page` khi đổi cột sắp: giữ trang 5 của thứ tự CŨ là nhìn vào một
                // lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
                url.setSorting(first ? { key: String(first.id), desc: !!first.desc } : { key: '', desc: false });
              }}
            />

            <Pagination
              page={page}
              limit={limit}
              onLimitChange={url.setLimit}
              total={rows.data?.total ?? 0}
              onPageChange={url.setPage}
            />
          </>
        )}
      </TabPanel>

      {editing ? (
        <CatalogForm
          entity={entity}
          row={editing.row}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {historyOf ? (
        <CatalogHistoryDialog
          entity={entity}
          id={historyOf.id}
          name={historyOf.name}
          onClose={() => setHistoryOf(null)}
        />
      ) : null}

      {importing ? (
        <CatalogImportDialog
          csrfToken={csrfToken}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** Sổ thay đổi của một mục — ai đổi địa chỉ site, ai tắt "Có port map" (AD-13, `HistoryPanel`). */
function CatalogHistoryDialog({
  entity,
  id,
  name,
  onClose,
}: {
  entity: CatalogEntity;
  id: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const history = useQuery({
    queryKey: ['catalog', entity, id, 'history'],
    queryFn: () => apiFetch<CatalogHistoryRow[]>(`/api/v1/catalog/${entity}/${id}/history`),
  });
  // Chỉ tủ mạng có "Thuộc site"; mục khác không cần tải danh mục để đọc sổ của nó.
  const lists = useCatalogLists({ enabled: entity === 'cabinet' });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t('catalog.historyOf', { name })}
    >
      {history.isLoading ? (
        <Loading />
      ) : history.isError ? (
        <LoadError error={history.error} onRetry={() => void history.refetch()} />
      ) : (
        <HistoryPanel
          entries={toCatalogHistory(history.data ?? [], t, lists.data?.sites)}
          emptyText={t('catalog.historyEmpty')}
        />
      )}
    </Dialog>
  );
}

/** Tab → mảng tương ứng trong `CatalogLists` (số mục trên nhãn tab). */
const LIST_OF: Record<CatalogEntity, keyof CatalogLists> = {
  site: 'sites',
  cabinet: 'cabinets',
  device_type: 'deviceTypes',
  vendor: 'vendors',
  department: 'departments',
  isp_provider: 'ispProviders',
  service_port: 'servicePorts',
};

const TAB_SUFFIX: Record<CatalogEntity, string> = {
  site: 'Site',
  cabinet: 'Cabinet',
  device_type: 'DeviceType',
  vendor: 'Vendor',
  department: 'Department',
  isp_provider: 'IspProvider',
  service_port: 'ServicePort',
};

/** Tham số của file xuất — cùng bộ lọc với bảng, không phân trang. */
function exportQuery(search: string, status: string, siteId: string, sorting: SortingState): string {
  return buildQuery(1, DEFAULT_LIMIT, search, status, siteId, sorting)
    .split('&')
    .filter((part) => !part.startsWith('page=') && !part.startsWith('limit='))
    .join('&');
}

function buildQuery(
  page: number,
  limit: number,
  search: string,
  status: string,
  siteId: string,
  sorting: SortingState,
): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  if (status) params.set('active', status === 'active' ? 'true' : 'false');
  if (siteId) params.set('siteId', siteId);
  return [params.toString(), sortQuery(sorting)].filter(Boolean).join('&');
}
