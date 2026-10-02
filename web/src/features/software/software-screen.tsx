import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { useDispose } from '@/ui/dispose-button';
import { RowActions } from '@/ui/row-actions';
import { LicenseSeatsExpand } from './license-seats-expand';
import { sortQuery } from '@/lib/sort-query';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { ALL_STATUSES, lifecycleStatusOptions } from '@/ui/lifecycle-status-options';
import { LifecycleHiddenEmpty } from '@/ui/lifecycle-hidden-empty';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { useToast } from '@/ui/toast';
import { RenewDialog } from '@/ui/renew-dialog';
import { useCatalogLists } from '@/ui/use-catalog-lists';
import { RestoreDialog } from './software-restore-dialog';
import { AssignDialog } from './assign-dialog';
import { SoftwareForm } from './software-form';
import { activeSeatCodes, softwareDisposeMessage } from './software-dispose-message';
import { standingOf } from './software-standing';
import { SeatUsage, SoftwareStanding } from './software-standing-cell';
import {
  KIND_KEY,
  SOFTWARE_STATUSES,
  STATUS_KEY,
  matchedDevicesText,
  seatLabel,
  supportsSeats,
  supportsWebsites,
  type LicenseModel,
  type SoftwareKind,
  type SoftwareRow,
  type SoftwareStatus,
} from './software-types';
import {
  SOFTWARE_SCREENS,
  legacySoftwareListRedirect,
  softwareItemPath,
  softwareKindsParam,
  type SoftwareScreenKey,
  type SoftwareScreenSpec,
} from '@/lib/software-screens';

const DEFAULT_LIMIT = 20;

/* `[key: string]: string` để khớp ràng buộc của `useListUrlState` — hook đọc/ghi bộ lọc theo
   TÊN KHÓA lên URL nên nó phải duyệt được các khóa. `kind`/`status` vẫn giữ union hẹp cho chỗ
   dùng. */
interface Filters extends Record<string, string> {
  search: string;
  /** Chỉ màn nhiều loại (Tên miền & SSL) mới lọc theo loại; '' = mọi loại của màn. */
  kind: '' | SoftwareKind;
  /** '' = còn dùng (Đang dùng + Hết hạn), mặc định; 'all' = mọi trạng thái kể cả Thanh lý. */
  status: '' | 'all' | SoftwareStatus;
  vendorId: string;
  licenseModel: '' | LicenseModel;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  kind: '',
  status: '',
  vendorId: '',
  licenseModel: '',
};

/**
 * Danh sách hồ sơ phần mềm (FR-008/FR-009) cho MỘT màn của Q-22: Phần mềm (license), Tên miền &
 * SSL, Hợp đồng bảo trì, Dịch vụ có hạn khác. Cùng một component, khác bảng `SOFTWARE_SCREENS`
 * (AD-15) — bốn bản chép sẽ trôi khác nhau đúng lúc luật thanh lý hay gia hạn đổi.
 *
 * Link cũ `/software?kind=ssl` (đã ghim, đã gửi) chuyển sang màn mới trước khi dựng gì cả.
 */
export function SoftwareScreen({ me, screen = 'software' }: { me: Me; screen?: SoftwareScreenKey }) {
  const { search } = useLocation();
  const moved = screen === 'software' ? legacySoftwareListRedirect(search) : null;
  if (moved) return <Navigate to={moved} replace />;
  return <SoftwareList me={me} spec={SOFTWARE_SCREENS[screen]} />;
}

function SoftwareList({ me, spec }: { me: Me; spec: SoftwareScreenSpec }) {
  const { t } = useTranslation();
  /* Cột và bộ lọc theo LOẠI của màn: ghế / kỳ hạn chỉ có ở license, cột Tên miền chỉ ở SSL /
     tên miền. Bày cột ghế trống trơn trên màn hợp đồng là bảo người đọc tìm thứ không có. */
  const manyKinds = spec.kinds.length > 1;
  const hasSeats = spec.kinds.some(supportsSeats);
  const hasDomains = spec.kinds.some(supportsWebsites);
  const toast = useToast();
  const queryClient = useQueryClient();
  /*
   * Bộ lọc · trang · số dòng · cột sắp nằm trên THANH ĐỊA CHỈ, không trong `useState`. Nhờ
   * vậy: F5 giữ nguyên bộ lọc, gửi được link "license sắp hết hạn" cho đồng nghiệp, và bấm
   * Back từ trang chi tiết về ĐÚNG kết quả cũ thay vì một danh sách trắng. Ô tìm có debounce
   * 250ms để mỗi phím không thành một lượt gọi API.
   */
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'code', desc: false },
    searchKey: 'search',
    // `?status=abc` đọc ra mặc định (ẩn hồ sơ cuối đời), không gửi chữ lạ lên API (Q-20).
    // `kind` chỉ nhận loại của màn; màn một loại thì mọi `kind` trên URL đều bị bỏ qua.
    allowed: {
      status: [...SOFTWARE_STATUSES, ALL_STATUSES],
      kind: manyKinds ? spec.kinds : [],
      licenseModel: hasSeats ? ['subscription', 'perpetual'] : [],
    },
  });
  /** Số dòng/trang do NGƯỜI DÙNG chọn (10/20/50/100), không còn là hằng số cứng. */
  const { page, limit } = url;
  const filters = url.filters;
  const statusOptions = lifecycleStatusOptions(t, {
    statuses: SOFTWARE_STATUSES,
    labelOf: (status) => t(STATUS_KEY[status]),
    endStatus: 'retired',
  });
  // Cùng bộ lọc, kể cả hồ sơ cuối đời — để biết bảng trống có phải vì chúng đang ẩn (Q-20).
  const hiddenProbeQuery = buildFilterQuery({ ...filters, status: ALL_STATUSES }, spec);
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả danh sách — sai mà không có dấu hiệu nào.
  const sorting: SortingState = [{ id: url.sorting.key, desc: url.sorting.desc }];
  const setPage = url.setPage;
  const setLimit = url.setLimit;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SoftwareRow | null>(null);
  const [assigning, setAssigning] = useState<SoftwareRow | null>(null);
  const [renewing, setRenewing] = useState<SoftwareRow | null>(null);
  const [restoring, setRestoring] = useState<SoftwareRow | null>(null);
  const lists = useCatalogLists();

  /* `useCallback`: `refresh` đi vào mảng phụ thuộc của `useMemo` dựng cột. Hàm mới mỗi lần
     render thì `useMemo` mất tác dụng và cả mảng cột được dựng lại sau mỗi phím gõ vào ô tìm. */
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['software'] }),
    [queryClient],
  );

  const software = useQuery({
    queryKey: ['software', spec.key, page, limit, filters, sorting],
    // Đổi trang/từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới: vẽ lại Loading là gỡ cả bảng,
    // mất dòng đang bung và bảng nháy trắng sau mỗi lần gõ tìm.
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<{ items: SoftwareRow[]; total: number }>(
        `/api/v1/software?${buildQuery(page, limit, filters, sorting, spec)}`,
      ),
  });
  useClampPage(url, software.data?.total);

  // Mọi bộ lọc đều đưa về trang 1 (hook tự xoá `page`): đổi bộ lọc mà giữ nguyên trang 5 thì
  // bảng trông như rỗng.
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    url.setFilter(key, value as string);
  };

  const rows = software.data?.items ?? [];

  /**
   * `id` của cột PHẢI khớp whitelist `SOFTWARE_SORT_KEYS` phía API — đó là tên cột gửi lên
   * trong `?sort=`. Cột "Nhà cung cấp" hiển thị qua danh mục, không sắp được: sắp theo nó đòi
   * join sang bảng của module khác, vi phạm AD-2. Cột "Seat" là số đã dùng/tổng, số đã dùng
   * tính từ bảng license_assignment nên không có cột thật để sắp.
   */
  const columns = useMemo<ColumnDef<SoftwareRow, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('software.code'),
        cell: ({ row }) => {
          const matched = matchedDevicesText(row.original.matchedDevices);
          return (
            <>
              <Link className="mono" to={softwareItemPath(row.original.kind, row.original.id)}>
                {row.original.code}
              </Link>
              {/* Hồ sơ hiện ra vì MÁY đang giữ ghế khớp ô tìm — nói ra, không thì người tìm
                  "LT-05" thấy một hồ sơ không có chữ đó và tưởng ô tìm hỏng (SW-010). */}
              {matched ? (
                <span className="cell-sub">
                  <span className="badge info plain">
                    {t('software.matchedDevices', { codes: matched })}
                  </span>
                </span>
              ) : null}
            </>
          );
        },
      },
      {
        /* Loại là dòng phụ dưới tên, không phải một cột riêng: bảng phải vừa 1280px với cột
           Thao tác còn trong khung. Màn một loại thì dòng phụ chỉ lặp lại tên màn — bỏ. */
        accessorKey: 'name',
        header: t('software.name'),
        cell: ({ row }) => (
          <>
            {row.original.name}
            {manyKinds ? (
              <span className="cell-sub">{t(KIND_KEY[row.original.kind])}</span>
            ) : null}
          </>
        ),
      },
      ...(hasDomains
        ? [
            {
              id: 'websites',
              header: t('software.domainNames'),
              cell: ({ row }: { row: { original: SoftwareRow } }) => (
                <DomainNames names={row.original.websites ?? []} />
              ),
            } satisfies ColumnDef<SoftwareRow, unknown>,
          ]
        : []),
      {
        id: 'vendorName',
        header: t('software.vendor'),
        cell: ({ row }) => orDash(row.original.vendorName),
      },
      ...(hasSeats
        ? [
            {
              id: 'seats',
              header: t('software.seats'),
              cell: ({ row }: { row: { original: SoftwareRow } }) => <SeatUsage item={row.original} />,
            } satisfies ColumnDef<SoftwareRow, unknown>,
          ]
        : []),
      {
        /* MỘT cột "Tình trạng" thay cho "Tình trạng hạn" + "Trạng thái" — xem
           `software-standing.ts`. Id `endDate` để bấm tiêu đề là sắp theo hạn. */
        accessorKey: 'endDate',
        header: t('software.standing'),
        cell: ({ row }) => <SoftwareStanding item={row.original} />,
      },
      {
        id: 'actions',
        header: t('common.actions'),
        meta: { className: 'col-center' },
        cell: ({ row }) => (
          <SoftwareRowActions
            item={row.original}
            csrfToken={me.csrfToken}
            onEdit={setEditing}
            onAssign={setAssigning}
            onRenew={setRenewing}
            onRestore={setRestoring}
            onDone={refresh}
          />
        ),
      },
    ],
    [t, me.csrfToken, refresh, manyKinds, hasDomains, hasSeats],
  );

  return (
    <>
      <PageHeader
        title={t(spec.titleKey)}
        subtitle={t(spec.subtitleKey)}
        actions={
          <>
            {/* FR-028: xuất đúng bộ lọc VÀ đúng thứ tự đang xem — cùng query với bảng dưới. */}
            <ExportXlsxButton
              url={`/api/v1/software/export.xlsx?${[buildFilterQuery(filters, spec), sortQuery(sorting)]
                .filter(Boolean)
                .join('&')}`}
              fileName={spec.exportFile}
            />
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            {t(spec.addKey)}
          </button>
          </>
        }
      />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t(spec.searchKey)}
      >
        {manyKinds ? (
          <Select
            value={filters.kind}
            ariaLabel={t('software.kind')}
            placeholder={t('software.allTypes')}
            options={[
              { value: '', label: t('software.allTypes') },
              ...spec.kinds.map((kind) => ({ value: kind, label: t(KIND_KEY[kind]) })),
            ]}
            onChange={(value) => setFilter('kind', value as Filters['kind'])}
          />
        ) : null}
        {/* Mặc định KHÔNG gồm Thanh lý: hồ sơ đã bỏ có Kho thanh lý riêng, và theo Q-13 số hồ
            sơ tự thanh lý tăng dần — trộn vào là danh sách việc hằng ngày loãng dần. */}
        <Select
          value={filters.status}
          ariaLabel={t('software.status')}
          placeholder={statusOptions[0].label}
          options={statusOptions}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
        <Select
          value={filters.vendorId}
          ariaLabel={t('software.vendor')}
          placeholder={t('software.allVendors')}
          failed={lists.isError}
          options={[
            { value: '', label: t('software.allVendors') },
            ...(lists.data?.vendors ?? []).map((vendor) => ({
              value: vendor.id,
              label: vendor.name,
            })),
          ]}
          onChange={(value) => setFilter('vendorId', value)}
        />
        {/* Kỳ hạn mua đứt / thuê bao chỉ có ở license. */}
        {hasSeats ? (
          <Select
            value={filters.licenseModel}
            ariaLabel={t('software.licenseModel')}
            placeholder={t('software.allModels')}
            options={[
              { value: '', label: t('software.allModels') },
              { value: 'subscription', label: t('software.subscription') },
              { value: 'perpetual', label: t('software.perpetual') },
            ]}
            onChange={(value) => setFilter('licenseModel', value as Filters['licenseModel'])}
          />
        ) : null}
      </FilterBar>

      {software.isLoading ? (
        <Loading />
      ) : software.isError ? (
        <LoadError error={software.error} onRetry={() => void software.refetch()} />
      ) : rows.length === 0 ? (
        <LifecycleHiddenEmpty
          probeKey={['software', spec.key, 'hidden-probe', hiddenProbeQuery]}
          probeUrl={filters.status === '' ? `/api/v1/software?page=1&limit=1&${hiddenProbeQuery}` : null}
          endLabel={t(STATUS_KEY['retired'])}
          allLabel={statusOptions[statusOptions.length - 1].label}
          onShowAll={() => setFilter('status', ALL_STATUSES)}
          fallback={
            <EmptyState
              /* HAI cảnh, HAI câu: "chưa khai gì" mời người dùng thêm bản ghi đầu tiên, "lọc không
                 ra" mời họ nới bộ lọc. Một câu cho cả hai thì hệ thống vừa cài xong báo "không khớp
                 bộ lọc" và người dùng đi tìm cái bộ lọc không tồn tại. */
              title={url.isFiltered ? t('software.emptyFiltered') : t(spec.emptyKey)}
              hint={url.isFiltered ? t('software.emptyFilteredHint') : t(spec.emptyHintKey)}
              action={
                url.isFiltered ? (
                  <button type="button" className="btn" onClick={url.clearFilters}>
                    {t('common.clearFilters')}
                  </button>
                ) : (
                  <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                    {t(spec.addKey)}
                  </button>
                )
              }
            />
          }
        />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('software.emptyFiltered') : t(spec.emptyKey)}
            stackOnMobile
            stickyActions
            /* ≤600px: thẻ 3 dòng để quét "cái gì sắp hết hạn" trên điện thoại. Thẻ không bung
               ghế — chạm thẻ mở chi tiết, ghế nằm ở tab Máy đang dùng. */
            mobileCard={{
              title: (item) => item.code,
              titleIsCode: true,
              href: (item) => softwareItemPath(item.kind, item.id),
              badge: (item) => <SoftwareStanding item={item} compact />,
              actions: (item) => (
                <SoftwareRowActions
                  item={item}
                  csrfToken={me.csrfToken}
                  onEdit={setEditing}
                  onAssign={setAssigning}
                  onRenew={setRenewing}
                  onRestore={setRestoring}
                  onDone={refresh}
                />
              ),
              subtitle: (item) => item.name,
              meta: (item) => cardMeta(item, t, manyKinds),
            }}
            /* Bung dòng ra là thấy MÁY NÀO đang dùng key (AC 3.2 + nếp QLTS, AD-12). Mọi
               license còn dùng đều bung được, kể cả chưa có ghế nào: khu bung rỗng là chỗ đặt
               nút "Gán vào máy" gần nhất. */
            canExpand={(item) => supportsSeats(item.kind) && item.status !== 'retired'}
            expandLabel={(item, open) =>
              t(open ? 'license.collapseLabel' : 'license.expandLabel', {
                code: item.code,
                count: item.seatUsed,
              })
            }
            // Hồ sơ Thanh lý chỉ hiện khi người dùng chọn "Mọi trạng thái" — làm mờ cho khỏi lẫn.
            rowClassName={(item) => (item.status === 'retired' ? 'row-muted' : '')}
            renderExpanded={(item) => (
              <LicenseSeatsExpand software={item} csrfToken={me.csrfToken} />
            )}
            manualSorting
            sorting={sorting}
            onSortingChange={(updater) => {
              const next = typeof updater === 'function' ? updater(sorting) : updater;
              const first = next[0];
              // Đổi cột sắp xếp thì hook tự bỏ `page` khỏi URL: giữ nguyên trang 5 của thứ tự
              // CŨ là nhìn vào một lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
              url.setSorting(
                first ? { key: String(first.id), desc: !!first.desc } : { key: 'code', desc: false },
              );
            }}
          />

          <Pagination
            page={page}
            limit={limit}
            onLimitChange={setLimit}
            total={software.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {creating ? (
        <SoftwareForm
          row={null}
          screen={spec.key}
          csrfToken={me.csrfToken}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void refresh();
          }}
        />
      ) : null}

      {editing ? (
        <SoftwareForm
          row={editing}
          screen={spec.key}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {renewing && renewing.endDate ? (
        <RenewDialog
          row={{
            kind: renewing.kind,
            id: renewing.id,
            code: renewing.code,
            label: renewing.name,
            end: renewing.endDate,
          }}
          kindLabel={t(KIND_KEY[renewing.kind])}
          url={`/api/v1/software/${renewing.id}/renew`}
          withTerms
          websites={supportsWebsites(renewing.kind) ? (renewing.websites ?? []) : undefined}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(null)}
          onDone={() => {
            setRenewing(null);
            void refresh();
          }}
        />
      ) : null}

      {restoring ? (
        <RestoreDialog
          software={restoring}
          csrfToken={me.csrfToken}
          onClose={() => setRestoring(null)}
          onDone={({ assigned, failures }) => {
            setRestoring(null);
            toast({ message: t('software.restored') });
            if (assigned > 0) {
              toast({ message: t('software.restoredAssigned', { count: assigned }) });
            }
            for (const failure of failures) toast({ message: failure, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}

      {assigning ? (
        <AssignDialog
          software={assigning}
          csrfToken={me.csrfToken}
          onClose={() => setAssigning(null)}
          onDone={(warnings, count) => {
            setAssigning(null);
            toast({ message: t('license.assignedCount', { count }) });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Cột "Thao tác" của một dòng phần mềm — Sửa · Gán vào máy · Gia hạn · Khôi phục… · Thanh lý.
 *
 * Là component RIÊNG chứ không phải một biểu thức trong `cell`, vì `useDispose` là hook: hàm
 * `cell` của TanStack Table chạy giữa lượt render của bảng, gọi hook trong đó là lệch số hook
 * giữa hai lượt.
 *
 * Sửa và Gán vẫn NGAY TRÊN DANH SÁCH, cùng nếp với màn thiết bị: đổi hạn hay nhét key vào một
 * máy là việc lặt vặt hằng ngày, bắt vào trang chi tiết rồi quay ra là ba lần chuyển trang cho
 * một ô. Cả hai mở ĐÚNG hộp cũ (`SoftwareForm`, `AssignDialog`) — AD-15 cấm bản thứ hai, hai
 * bản sẽ trôi khác nhau đúng lúc luật vượt seat đổi.
 */
function SoftwareRowActions({
  item,
  csrfToken,
  onEdit,
  onAssign,
  onRenew,
  onRestore,
  onDone,
}: {
  item: SoftwareRow;
  csrfToken: string;
  onEdit: (row: SoftwareRow) => void;
  onAssign: (row: SoftwareRow) => void;
  onRenew: (row: SoftwareRow) => void;
  onRestore: (row: SoftwareRow) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const dispose = useDispose({
    url: `/api/v1/software/${item.id}`,
    body: { status: 'retired' },
    label: t('disposal.dispose'),
    confirmMessage: softwareDisposeMessage(t, item.code, item.seatUsed, null),
    // Mã máy chỉ đọc khi người dùng thật sự bấm thanh lý — không đọc sẵn cho cả trang.
    resolveMessage:
      item.seatUsed > 0
        ? async () =>
            softwareDisposeMessage(t, item.code, item.seatUsed, await activeSeatCodes(item.id))
        : undefined,
    csrfToken,
    onDone,
  });

  return (
    <RowActions
      primary={{
        label: t('common.edit'),
        ariaLabel: t('common.editOf', { subject: item.code }),
        onClick: () => onEdit(item),
      }}
      label={t('common.actionsOf', { subject: item.code })}
      items={[
        /* Chỉ license CÒN DÙNG mới có ghế để gán. SSL hay tên miền, hoặc hồ sơ đã Thanh lý,
           thì mục này vô nghĩa — bày ra để bấm vào rồi báo lỗi là một kiểu hứa hão. */
        ...(supportsSeats(item.kind) && item.status !== 'retired'
          ? [
              {
                key: 'assign',
                label: t('license.assign'),
                onSelect: () => onAssign(item),
              },
            ]
          : []),
        /* Gia hạn: hồ sơ thuê bao còn sống có hạn. Hồ sơ Thanh lý thì là "Khôi phục…" (Q-13:
           hồi sinh là một thao tác Sửa có chủ ý, Gia hạn không dùng cho nó). */
        ...(item.status !== 'retired' && item.licenseModel !== 'perpetual' && item.endDate
          ? [{ key: 'renew', label: t('software.renew'), onSelect: () => onRenew(item) }]
          : []),
        ...(item.status === 'retired'
          ? [
              {
                key: 'restore',
                label: t('software.restore'),
                onSelect: () => onRestore(item),
                ok: true,
              },
            ]
          : []),
        /* Hồ sơ đã bỏ thì không bày mục bỏ nữa — bấm lần hai chỉ ghi thêm một dòng lịch sử
           rỗng nghĩa. */
        ...(item.status !== 'retired'
          ? [
              {
                key: 'dispose',
                label: t('software.disposeMenu'),
                onSelect: dispose.run,
                danger: true,
                disabled: dispose.isPending,
              },
            ]
          : []),
      ]}
    />
  );
}

/**
 * Ô "Tên miền": tên đầu + "+N", rê chuột thấy đủ (Q-22). Một hồ sơ có thể gom hàng chục tên
 * miền dùng chung một hạn — in hết thì một dòng cao bằng cả trang.
 */
function DomainNames({ names }: { names: string[] }) {
  const { t } = useTranslation();
  if (names.length === 0) return <>{orDash(null)}</>;
  return (
    <span title={names.join(', ')}>
      <span className="mono">{names[0]}</span>
      {names.length > 1 ? (
        <>
          {' '}
          <span className="badge plain">{t('software.domainNamesMore', { count: names.length - 1 })}</span>
        </>
      ) : null}
    </span>
  );
}

/** Dòng 3 của thẻ điện thoại: "6/10 ghế · Microsoft VN · quá 3 ngày" (kèm loại ở màn nhiều loại). */
function cardMeta(item: SoftwareRow, t: TFunction, withKind: boolean): string {
  const standing = standingOf(item);
  const matched = matchedDevicesText(item.matchedDevices);
  const names = item.websites ?? [];
  return [
    matched ? t('software.matchedDevices', { codes: matched }) : null,
    withKind ? t(KIND_KEY[item.kind]) : null,
    names.length > 0
      ? `${names[0]}${names.length > 1 ? ` ${t('software.domainNamesMore', { count: names.length - 1 })}` : ''}`
      : null,
    supportsSeats(item.kind) && item.seatTotal !== null
      ? `${seatLabel(item)} ${t('software.seats').toLowerCase()}`
      : null,
    item.vendorName,
    standing.kind === 'expired' && standing.retireInDays !== null
      ? t('software.autoRetireIn', { count: standing.retireInDays })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function buildQuery(
  page: number,
  limit: number,
  filters: Filters,
  sorting: SortingState,
  spec: SoftwareScreenSpec,
): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return [params.toString(), buildFilterQuery(filters, spec), sortQuery(sorting)]
    .filter(Boolean)
    .join('&');
}

/**
 * Phần lọc (không kèm phân trang) — dùng CHUNG cho danh sách và cho nút Xuất Excel, nên
 * file xuất ra luôn khớp đúng cái đang nhìn thấy (FR-028).
 */
function buildFilterQuery(filters: Filters, spec: SoftwareScreenSpec): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  // Màn luôn hỏi đúng loại của nó (Q-22) — kể cả khi chưa chọn gì ở ô Loại.
  params.set('kind', softwareKindsParam(spec, filters.kind));
  // '' = mặc định "còn dùng" (API: `live`); 'all' = không lọc trạng thái.
  if (filters.status !== 'all') params.set('status', filters.status || 'live');
  if (filters.vendorId) params.set('vendorId', filters.vendorId);
  if (filters.licenseModel) params.set('licenseModel', filters.licenseModel);
  return params.toString();
}
