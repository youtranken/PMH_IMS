import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { sortQuery } from '@/lib/sort-query';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { CatalogForm } from './catalog-form';
import { CatalogImportDialog } from './catalog-import-dialog';
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
} from './catalog-types';

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

/**
 * Cột riêng từng loại (AD-15: giữ cách tổ chức "một hằng theo tab" như bản `<table>` cũ,
 * chỉ đổi sang `ColumnDef` của `DataTable`).
 *
 * `accessorKey` PHẢI trùng khóa whitelist `CATALOG_SORT_KEYS` phía API — đó là tên cột gửi
 * lên trong `?sort=`. Cột chỉ có `id` (không `accessorKey`) sẽ không có nút sắp: đúng ý với
 * `siteCode` của tủ mạng, giá trị đó lấy qua JOIN sang bảng site nên KHÔNG được sắp (AD-2).
 */
const ENTITY_COLUMNS: Record<CatalogEntity, (t: TFunction) => ColumnDef<CatalogRow, unknown>[]> = {
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
      cell: ({ row }) => orDash((row.original as SiteRow).address),
    },
  ],
  cabinet: (t) => [
    {
      accessorKey: 'code',
      header: t('catalog.code'),
      cell: ({ row }) => <span className="mono">{(row.original as CabinetRow).code}</span>,
    },
    {
      // Không có accessorKey: `siteCode` là JOIN sang bảng site (AD-2) — không sắp được.
      id: 'siteCode',
      header: t('catalog.site'),
      cell: ({ row }) => <span className="mono">{(row.original as CabinetRow).siteCode}</span>,
    },
    {
      accessorKey: 'description',
      header: t('catalog.description'),
      cell: ({ row }) => orDash((row.original as CabinetRow).description),
    },
    {
      accessorKey: 'uHeight',
      header: t('catalog.uHeight'),
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
      accessorKey: 'description',
      header: t('catalog.description'),
      cell: ({ row }) => orDash((row.original as DeviceTypeRow).description),
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
      cell: ({ row }) => orDash((row.original as VendorRow).supplies),
    },
    {
      accessorKey: 'phone',
      header: t('catalog.phone'),
      cell: ({ row }) => orDash((row.original as VendorRow).phone),
    },
    {
      accessorKey: 'contact',
      header: t('catalog.contact'),
      cell: ({ row }) => orDash((row.original as VendorRow).contact),
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
      cell: ({ row }) => orDash((row.original as DepartmentRow).description),
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
      cell: ({ row }) => {
        const hotline = (row.original as IspProviderRow).hotline;
        // Bấm gọi được: đứt cáp lúc 2 giờ sáng thì người ta cầm điện thoại, không cầm chuột.
        return hotline ? (
          <a className="mono" href={`tel:${hotline.replace(/\s+/g, '')}`}>
            {hotline}
          </a>
        ) : (
          '—'
        );
      },
    },
    {
      accessorKey: 'contact',
      header: t('catalog.contact'),
      cell: ({ row }) => orDash((row.original as IspProviderRow).contact),
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
      meta: { className: 'mono' },
      cell: ({ row }) => portRangeLabel(row.original as ServicePortRow),
    },
    {
      accessorKey: 'description',
      header: t('catalog.description'),
      cell: ({ row }) => orDash((row.original as ServicePortRow).description),
    },
  ],
};

/**
 * Quản trị danh mục (story 2.1, FR-004).
 * Member VÀO XEM được (form thiết bị cần biết danh mục có gì) nhưng không thấy nút sửa —
 * chốt quyền thật nằm ở `@Roles` phía API, đây chỉ là ẩn cho đỡ rối (AD-9).
 */
export function CatalogScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();

  const [entity, setEntity] = useState<CatalogEntity>('site');
  const [page, setPage] = useState(1);
  /** Số dòng/trang do NGƯỜI DÙNG chọn (10/20/50/100), không còn là hằng số cứng. */
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [search, setSearch] = useState('');
  // Sắp xếp chạy ở SERVER (`manualSorting`) — lý do giống màn Thiết bị: bảng phân trang
  // 20 dòng/trang, sắp ở client chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả danh mục.
  const [sorting, setSorting] = useState<SortingState>(ENTITY_DEFAULT_SORT.site);
  const [editing, setEditing] = useState<{ row: CatalogRow | null } | null>(null);
  const [importing, setImporting] = useState(false);

  const canEdit = me.role === 'sa' || me.role === 'admin';
  const csrfToken = me.csrfToken;
  const importable = (IMPORTABLE_ENTITIES as readonly string[]).includes(entity);

  const rows = useQuery({
    queryKey: ['catalog', entity, page, limit, search, sorting],
    queryFn: () =>
      apiFetch<{ items: CatalogRow[]; total: number }>(
        `/api/v1/catalog/${entity}?${buildQuery(page, limit, search, sorting)}`,
      ),
  });

  // Danh sách site cho ô chọn của form tủ mạng. Lấy CẢ mục đã vô hiệu để sửa tủ cũ
  // không bị mất site đang gắn.
  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

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

  const switchTab = (key: string) => {
    const nextEntity = key as CatalogEntity;
    setEntity(nextEntity);
    // Giữ nguyên trang 3 / từ khóa cũ / thứ tự sắp của tab trước khi sang tab khác thì bảng
    // trông như rỗng hoặc sắp theo cột không tồn tại ở tab mới.
    setPage(1);
    setSearch('');
    setSorting(ENTITY_DEFAULT_SORT[nextEntity]);
  };

  const columns = useMemo<ColumnDef<CatalogRow, unknown>[]>(() => {
    const entityColumns = ENTITY_COLUMNS[entity](t);
    const statusColumn: ColumnDef<CatalogRow, unknown> = {
      accessorKey: 'active',
      header: t('catalog.status'),
      cell: ({ row }) => (
        <span className={`badge ${row.original.active ? 'ok' : 'muted'}`}>
          {t(row.original.active ? 'catalog.active' : 'catalog.inactive')}
        </span>
      ),
    };
    if (!canEdit) return [...entityColumns, statusColumn];

    const actionsColumn: ColumnDef<CatalogRow, unknown> = {
      id: 'actions',
      header: t('common.actions'),
      meta: { className: 'col-center' },
      cell: ({ row }) => {
        const catalogRow = row.original;
        return (
          <div className="action-cell">
            <button type="button" className="btn sm" onClick={() => setEditing({ row: catalogRow })}>
              {t('catalog.edit')}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                void (async () => {
                  const name = catalogLabel(entity, catalogRow);
                  const ok = await askConfirm({
                    message: t(
                      catalogRow.active ? 'catalog.confirmDeactivate' : 'catalog.confirmActivate',
                      { name },
                    ),
                    danger: catalogRow.active,
                    confirmLabel: t(catalogRow.active ? 'catalog.deactivate' : 'catalog.activate'),
                  });
                  if (!ok) return;
                  setActive.mutate(
                    { id: catalogRow.id, active: !catalogRow.active },
                    {
                      onSuccess: () => void refresh(),
                      onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
                    },
                  );
                })();
              }}
            >
              {t(catalogRow.active ? 'catalog.deactivate' : 'catalog.activate')}
            </button>
            <button
              type="button"
              className="btn sm danger"
              onClick={() => {
                void (async () => {
                  const name = catalogLabel(entity, catalogRow);
                  const ok = await askConfirm({
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
                      // Xóa mục đang được thiết bị dùng → API trả 409 kèm câu gợi ý
                      // "hãy vô hiệu hóa"; hiện nguyên văn cho người dùng.
                      onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
                    },
                  );
                })();
              }}
            >
              {t('catalog.delete')}
            </button>
          </div>
        );
      },
    };
    return [...entityColumns, statusColumn, actionsColumn];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, t, canEdit]);

  return (
    <>
      <PageHeader
        title={t('catalog.title')}
        subtitle={t('catalog.subtitle')}
        actions={
          <>
            {/* File mẫu và đường nhập Excel chỉ có nghĩa với bốn danh mục gốc. Ba danh mục
                của 0028 vài chục dòng, khai tay là xong — bày nút "Nhập Excel" ở đó là hứa
                một đường đi mà file mẫu không hề có sheet cho nó. */}
            {importable ? (
              <ExportXlsxButton
                url="/api/v1/catalog/template"
                fileName="mau-danh-muc.xlsx"
                label={t('catalog.downloadTemplate')}
              />
            ) : null}
            {canEdit ? (
              <>
                {importable ? (
                  <button type="button" className="btn" onClick={() => setImporting(true)}>
                    {t('catalog.importExcel')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => setEditing({ row: null })}
                >
                  {t(`catalog.add${TAB_SUFFIX[entity]}`)}
                </button>
              </>
            ) : null}
          </>
        }
      />

      <Tabs
        items={TAB_KEYS.map((tab) => ({ key: tab.key, label: t(tab.labelKey) }))}
        value={entity}
        onChange={switchTab}
        ariaLabel={t('catalog.title')}
      />

      <TabPanel tabKey={entity}>
        <FilterBar
          search={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          searchPlaceholder={t(TAB_KEYS.find((tab) => tab.key === entity)!.searchKey)}
        />

        {!canEdit ? <p className="muted">{t('catalog.readOnly')}</p> : null}

        {rows.isLoading ? (
          <Loading />
        ) : rows.isError ? (
          <LoadError onRetry={() => void rows.refetch()} />
        ) : (
          <>
            <DataTable
              data={items}
              columns={columns}
              emptyText={`${t('common.empty')} — ${t('catalog.templateHint')}`}
              stackOnMobile
              rowClassName={(row) => (row.active ? '' : 'row-muted')}
              manualSorting
              sorting={sorting}
              onSortingChange={(updater) => {
                setSorting((current) =>
                  typeof updater === 'function' ? updater(current) : updater,
                );
                // Đổi cột sắp xếp thì về trang 1: giữ nguyên trang 5 của thứ tự CŨ là nhìn vào
                // một lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
                setPage(1);
              }}
            />

            <Pagination
              page={page}
              limit={limit}
            onLimitChange={setLimit}
              total={rows.data?.total ?? 0}
              onPageChange={setPage}
            />
          </>
        )}
      </TabPanel>

      {editing ? (
        <CatalogForm
          entity={entity}
          row={editing.row}
          lists={lists.data}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
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

const TAB_SUFFIX: Record<CatalogEntity, string> = {
  site: 'Site',
  cabinet: 'Cabinet',
  device_type: 'DeviceType',
  vendor: 'Vendor',
  department: 'Department',
  isp_provider: 'IspProvider',
  service_port: 'ServicePort',
};

function buildQuery(page: number, limit: number, search: string, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search) params.set('search', search);
  return [params.toString(), sortQuery(sorting)].filter(Boolean).join('&');
}
