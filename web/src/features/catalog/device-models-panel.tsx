import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { lowerFirstAfterNumber } from '@/lib/count-label';
import { DEVICE_MODELS_KEY, type DeviceModel } from '@/lib/device-models';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { useConfirm } from '@/ui/confirm-provider';
import { DataTable, type MobileCard } from '@/ui/data-table';
import { DeviceModelDialog } from '@/ui/device-model-dialog';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Pagination } from '@/ui/pagination';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { useDebouncedValue } from '@/ui/use-debounced-value';

const LIMIT = 20;

/**
 * Tab "Model thiết bị" của Danh mục (Q-26). Bảng thuộc `devices` (AD-3) nên tab này gọi
 * `/api/v1/device-models`, không đi đường chung của các danh mục `catalog`.
 *
 * Mọi vai thêm được model (form thiết bị cũng tạo tại chỗ); sửa / xóa chỉ Admin/SA vì đổi đặc tính
 * cả loạt máy — API chặn bằng `@Roles`, ở đây chỉ không bày việc đó ra.
 */
export function DeviceModelsPanel({ me, adding, onAddingChange }: { me: Me; adding: boolean; onAddingChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lists = useCatalogLists();
  const canManage = me.role === 'sa' || me.role === 'admin';
  const [search, setSearch] = useState('');
  const [deviceTypeId, setDeviceTypeId] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(LIMIT);
  const [editing, setEditing] = useState<DeviceModel | null>(null);
  const settled = useDebouncedValue(search);

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (settled.trim()) params.set('search', settled.trim());
  if (deviceTypeId) params.set('deviceTypeId', deviceTypeId);
  const rows = useQuery({
    queryKey: [...DEVICE_MODELS_KEY, params.toString()],
    queryFn: () => apiFetch<{ items: DeviceModel[]; total: number }>(`/api/v1/device-models?${params.toString()}`),
    placeholderData: keepPreviousData,
  });
  const items = rows.data?.items ?? [];
  const activeCount = (search.trim() ? 1 : 0) + (deviceTypeId ? 1 : 0);

  const remove = async (model: DeviceModel) => {
    const ok = await askConfirm({
      title: t('deviceModels.confirmDeleteTitle', { model: model.model }),
      message: t('deviceModels.confirmDelete'),
      confirmLabel: t('deviceModels.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch<void>(`/api/v1/device-models/${model.id}`, { method: 'DELETE', csrfToken: me.csrfToken });
      await queryClient.invalidateQueries({ queryKey: DEVICE_MODELS_KEY });
      toast({ tone: 'ok', message: t('deviceModels.deleted', { model: model.model }) });
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  const devicesHref = (model: DeviceModel) => `${PATHS.devices}?search=${encodeURIComponent(model.model)}`;
  const rackText = (model: DeviceModel) => (model.rackMountable ? t('deviceModels.rackUnits', { count: model.uSize ?? 0 }) : t('deviceModels.rackNone'));
  const actionsOf = (model: DeviceModel) => {
    const items: RowAction[] = [{ key: 'devices', label: t('deviceModels.viewDevices'), onSelect: () => navigate(devicesHref(model)) }];
    if (canManage) {
      items.unshift({ key: 'edit', label: t('deviceModels.edit'), onSelect: () => setEditing(model) });
      items.push({ key: 'delete', label: t('deviceModels.delete'), danger: true, onSelect: () => void remove(model) });
    }
    return <RowActions label={t('deviceModels.actionsOf', { model: model.model })} items={items} />;
  };
  const photo = (model: DeviceModel) =>
    model.photoFrontFileId ? (
      <img
        className="photo-thumb wide"
        src={`/api/v1/device-models/${model.id}/photo/front?v=${encodeURIComponent(model.updatedAt)}`}
        alt={t('deviceModels.photoAlt', { model: model.model })}
      />
    ) : (
      <span className="muted">{t('deviceModels.noPhoto')}</span>
    );

  const columns: ColumnDef<DeviceModel, unknown>[] = [
    { id: 'photo', header: t('deviceModels.colPhoto'), cell: ({ row }) => photo(row.original) },
    { id: 'manufacturer', header: t('deviceModels.colManufacturer'), cell: ({ row }) => orDash(row.original.manufacturer) },
    { id: 'model', header: t('deviceModels.colModel'), cell: ({ row }) => <span className="mono">{row.original.model}</span> },
    { id: 'type', header: t('deviceModels.colType'), cell: ({ row }) => row.original.deviceTypeName },
    { id: 'rack', header: t('deviceModels.colRack'), cell: ({ row }) => rackText(row.original) },
    {
      id: 'devices',
      header: t('deviceModels.colDevices'),
      cell: ({ row }) =>
        row.original.deviceCount > 0 ? (
          <Link to={devicesHref(row.original)}>{lowerFirstAfterNumber(t('deviceModels.devicesCount', { count: row.original.deviceCount }))}</Link>
        ) : (
          lowerFirstAfterNumber(t('deviceModels.devicesCount', { count: 0 }))
        ),
    },
    { id: 'actions', header: '', cell: ({ row }) => actionsOf(row.original) },
  ];
  const mobileCard: MobileCard<DeviceModel> = {
    title: (model) => model.model,
    titleIsCode: true,
    subtitle: (model) => [model.manufacturer, model.deviceTypeName].filter(Boolean).join(' · '),
    meta: (model) => [rackText(model), lowerFirstAfterNumber(t('deviceModels.devicesCount', { count: model.deviceCount }))].join(' · '),
    actions: (model) => actionsOf(model),
  };

  return (
    <>
      <FilterBar
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t('deviceModels.search')}
        activeCount={activeCount}
        onClear={() => {
          setSearch('');
          setDeviceTypeId('');
          setPage(1);
        }}
      >
        <Select
          value={deviceTypeId}
          ariaLabel={t('deviceModels.colType')}
          failed={lists.isError}
          options={[{ value: '', label: t('deviceModels.allTypes') }, ...activeOptions(lists.data?.deviceTypes, deviceTypeId, (type) => type.name)]}
          onChange={(value) => {
            setDeviceTypeId(value);
            setPage(1);
          }}
        />
      </FilterBar>
      {canManage ? null : <p className="muted catalog-member-hint">{t('deviceModels.memberHint')}</p>}
      {rows.isLoading ? (
        <Loading variant="table" />
      ) : rows.isError ? (
        <LoadError error={rows.error} onRetry={() => void rows.refetch()} />
      ) : items.length === 0 && activeCount > 0 ? (
        <EmptyState title={t('deviceModels.emptyFiltered')} />
      ) : (
        <>
          <DataTable data={items} columns={columns} emptyText={t('deviceModels.empty')} stackOnMobile mobileCard={mobileCard} />
          <Pagination page={page} limit={limit} onLimitChange={setLimit} total={rows.data?.total ?? 0} onPageChange={setPage} />
        </>
      )}
      {adding || editing ? (
        <DeviceModelDialog
          csrfToken={me.csrfToken}
          canManage={canManage}
          model={editing}
          onClose={() => {
            setEditing(null);
            onAddingChange(false);
          }}
          onSaved={() => undefined}
        />
      ) : null}
    </>
  );
}
