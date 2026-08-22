import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
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
  type CabinetRow,
  type CatalogEntity,
  type CatalogLists,
  type CatalogRow,
  type DeviceTypeRow,
  type SiteRow,
  type VendorRow,
} from './catalog-types';

const LIMIT = 20;

const TAB_KEYS: { key: CatalogEntity; labelKey: string; searchKey: string }[] = [
  { key: 'site', labelKey: 'catalog.tabSite', searchKey: 'catalog.searchSite' },
  { key: 'cabinet', labelKey: 'catalog.tabCabinet', searchKey: 'catalog.searchCabinet' },
  { key: 'device_type', labelKey: 'catalog.tabDeviceType', searchKey: 'catalog.searchDeviceType' },
  { key: 'vendor', labelKey: 'catalog.tabVendor', searchKey: 'catalog.searchVendor' },
];

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
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ row: CatalogRow | null } | null>(null);
  const [importing, setImporting] = useState(false);

  const canEdit = me.role === 'sa' || me.role === 'admin';
  const csrfToken = me.csrfToken;

  const rows = useQuery({
    queryKey: ['catalog', entity, page, search],
    queryFn: () =>
      apiFetch<{ items: CatalogRow[]; total: number }>(
        `/api/v1/catalog/${entity}?page=${page}&limit=${LIMIT}${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
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
    setEntity(key as CatalogEntity);
    // Giữ nguyên trang 3 / từ khóa cũ khi sang tab khác thì bảng trông như rỗng.
    setPage(1);
    setSearch('');
  };

  return (
    <>
      <PageHeader
        title={t('catalog.title')}
        subtitle={t('catalog.subtitle')}
        actions={
          <>
            <ExportXlsxButton
              url="/api/v1/catalog/template"
              fileName="mau-danh-muc.xlsx"
              label={t('catalog.downloadTemplate')}
            />
            {canEdit ? (
              <>
                <button type="button" className="btn" onClick={() => setImporting(true)}>
                  {t('catalog.importExcel')}
                </button>
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
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    {COLUMNS[entity].map((column) => (
                      <th key={column.header}>{t(column.header)}</th>
                    ))}
                    <th>{t('catalog.status')}</th>
                    {canEdit ? <th className="col-center">{t('common.actions')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td
                        colSpan={COLUMNS[entity].length + (canEdit ? 2 : 1)}
                        className="muted"
                        style={{ textAlign: 'center' }}
                      >
                        {t('common.empty')} — {t('catalog.templateHint')}
                      </td>
                    </tr>
                  ) : null}
                  {items.map((row) => (
                    <tr key={row.id} className={row.active ? undefined : 'row-muted'}>
                      {COLUMNS[entity].map((column) => (
                        <td key={column.header} data-label={t(column.header)}>
                          {column.cell(row)}
                        </td>
                      ))}
                      <td data-label={t('catalog.status')}>
                        <span className={`badge ${row.active ? 'ok' : 'muted'}`}>
                          {t(row.active ? 'catalog.active' : 'catalog.inactive')}
                        </span>
                      </td>
                      {canEdit ? (
                        <td>
                          <div className="action-cell">
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => setEditing({ row })}
                            >
                              {t('catalog.edit')}
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => {
                                void (async () => {
                                  const name = catalogLabel(entity, row);
                                  const ok = await askConfirm({
                                    message: t(
                                      row.active
                                        ? 'catalog.confirmDeactivate'
                                        : 'catalog.confirmActivate',
                                      { name },
                                    ),
                                    danger: row.active,
                                  });
                                  if (!ok) return;
                                  setActive.mutate(
                                    { id: row.id, active: !row.active },
                                    {
                                      onSuccess: () => void refresh(),
                                      onError: (err) =>
                                        toast({ message: errorMessage(err), tone: 'error' }),
                                    },
                                  );
                                })();
                              }}
                            >
                              {t(row.active ? 'catalog.deactivate' : 'catalog.activate')}
                            </button>
                            <button
                              type="button"
                              className="btn sm danger"
                              onClick={() => {
                                void (async () => {
                                  const name = catalogLabel(entity, row);
                                  const ok = await askConfirm({
                                    message: t('catalog.confirmDelete', { name }),
                                    danger: true,
                                  });
                                  if (!ok) return;
                                  remove.mutate(
                                    { id: row.id },
                                    {
                                      onSuccess: () => {
                                        toast({ message: t('catalog.deleted') });
                                        void refresh();
                                      },
                                      // Xóa mục đang được thiết bị dùng → API trả 409 kèm câu
                                      // gợi ý "hãy vô hiệu hóa"; hiện nguyên văn cho người dùng.
                                      onError: (err) =>
                                        toast({ message: errorMessage(err), tone: 'error' }),
                                    },
                                  );
                                })();
                              }}
                            >
                              {t('catalog.delete')}
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              limit={LIMIT}
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
};

interface Column {
  header: string;
  cell: (row: CatalogRow) => ReactNode;
}

/** Cột theo từng loại — khai một chỗ để bảng và tiêu đề không lệch nhau. */
const COLUMNS: Record<CatalogEntity, Column[]> = {
  site: [
    { header: 'catalog.code', cell: (row) => <span className="mono">{(row as SiteRow).code}</span> },
    { header: 'catalog.name', cell: (row) => (row as SiteRow).name },
    { header: 'catalog.address', cell: (row) => orDash((row as SiteRow).address) },
  ],
  cabinet: [
    {
      header: 'catalog.code',
      cell: (row) => <span className="mono">{(row as CabinetRow).code}</span>,
    },
    {
      header: 'catalog.site',
      cell: (row) => <span className="mono">{(row as CabinetRow).siteCode}</span>,
    },
    { header: 'catalog.description', cell: (row) => orDash((row as CabinetRow).description) },
    { header: 'catalog.uHeight', cell: (row) => orDash((row as CabinetRow).uHeight) },
  ],
  device_type: [
    { header: 'catalog.name', cell: (row) => (row as DeviceTypeRow).name },
    {
      header: 'catalog.hasPortMap',
      cell: (row) => (
        <span className={`badge ${(row as DeviceTypeRow).hasPortMap ? 'ok' : 'muted'}`}>
          {(row as DeviceTypeRow).hasPortMap ? 'Có' : 'Không'}
        </span>
      ),
    },
    { header: 'catalog.description', cell: (row) => orDash((row as DeviceTypeRow).description) },
  ],
  vendor: [
    { header: 'catalog.name', cell: (row) => (row as VendorRow).name },
    { header: 'catalog.supplies', cell: (row) => orDash((row as VendorRow).supplies) },
    { header: 'catalog.phone', cell: (row) => orDash((row as VendorRow).phone) },
    { header: 'catalog.contact', cell: (row) => orDash((row as VendorRow).contact) },
  ],
};
