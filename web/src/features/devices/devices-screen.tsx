import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable, type MobileCard } from '@/ui/data-table';
import { sortQuery } from '@/lib/sort-query';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { LocationText } from '@/ui/location-text';
import { FilterBar } from '@/ui/filter-bar';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { errorMessage, useApiMutation } from '@/lib/api';
import { PageHeader } from '@/ui/page-header';
import { useToast } from '@/ui/toast';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { lifecycleStatusOptions } from '@/ui/lifecycle-status-options';
import { DeviceLicensesExpand } from '@/features/software/device-licenses-expand';
import { ExpandPanel } from '@/ui/expand-panel';
import { DeviceForm } from './device-form';
import { DeviceImportDialog } from './device-import-dialog';
import { DeviceRowActions } from './device-actions';
import { StatusDialog } from './status-dialog';
import {
  DEVICE_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  locationLabel,
  type DeviceRow,
  type DeviceStatus,
} from '@/lib/device-types';
import { PATHS } from '@/lib/routes';
import { useCatalogLists } from '@/ui/use-catalog-lists';

const DEFAULT_LIMIT = 20;

/* `[key: string]: string` để khớp ràng buộc của `useListUrlState` — hook đọc/ghi bộ lọc theo
   TÊN KHÓA lên URL nên nó phải duyệt được các khóa. `status` vẫn giữ union hẹp cho chỗ dùng. */
interface Filters extends Record<string, string> {
  search: string;
  siteId: string;
  cabinetId: string;
  deviceTypeId: string;
  /** '' = mặc định "trừ Đã thanh lý" (API `live`, Q-20); 'all' = không lọc trạng thái. */
  status: '' | 'all' | DeviceStatus;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  siteId: '',
  cabinetId: '',
  deviceTypeId: '',
  status: '',
};

/** Kho thiết bị — lọc theo site/tủ/loại/trạng thái, tìm theo mã/tên/serial/model. */
export function DevicesScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  /*
   * Bộ lọc · trang · số dòng · cột sắp nằm trên THANH ĐỊA CHỈ, không trong `useState`. Nhờ
   * vậy: F5 giữ nguyên bộ lọc, gửi được link "máy hỏng ở tủ T-1" cho đồng nghiệp, và bấm Back
   * từ trang chi tiết về ĐÚNG kết quả cũ thay vì một danh sách trắng. Ô tìm có debounce 250ms
   * để mỗi phím không thành một lượt gọi API.
   */
  const url = useListUrlState<Filters>({
    emptyFilters: EMPTY_FILTERS,
    defaultLimit: DEFAULT_LIMIT,
    defaultSort: { key: 'code', desc: false },
    searchKey: 'search',
  });
  const { page, limit } = url;
  const filters = url.filters;
  const statusOptions = lifecycleStatusOptions(t, {
    statuses: DEVICE_STATUSES,
    labelOf: (status) => t(STATUS_KEY[status]),
    endStatus: 'retired',
  });
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả kho — sai mà không có dấu hiệu nào.
  const sorting: SortingState = [{ id: url.sorting.key, desc: url.sorting.desc }];
  const setPage = url.setPage;
  const setLimit = url.setLimit;
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [cloning, setCloning] = useState<DeviceRow | null>(null);
  /** Hộp đổi trạng thái — cũng là hộp mở lại máy đã thanh lý. */
  const [statusOf, setStatusOf] = useState<DeviceRow | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const setStatus = useApiMutation<{ id: string; status: DeviceStatus }, unknown>(
    (input) => `/api/v1/devices/${input.id}/status`,
    {
      method: 'PATCH',
      csrfToken: me.csrfToken,
      refreshMe: false,
      body: (input) => ({ status: input.status }),
    },
  );
  const openStatus = useCallback((device: DeviceRow) => {
    setStatusError(null);
    setStatusOf(device);
  }, []);
  /* Máy vừa thêm sáng lên một lúc nếu nó nằm ở trang đang xem. Gỡ cờ khi hiệu ứng chạy xong:
     để lại thì mỗi lần bảng vẽ lại (đổi trang rồi quay về) dòng đó lại nháy. */
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!flashId) return;
    const timer = window.setTimeout(() => setFlashId(null), 2600);
    return () => window.clearTimeout(timer);
  }, [flashId]);

  const lists = useCatalogLists();

  const devices = useQuery({
    queryKey: ['devices', page, limit, filters, sorting],
    // Đổi trang/từ khoá thì GIỮ bảng cũ tới khi có dữ liệu mới: vẽ lại Loading là gỡ cả bảng,
    // mất dòng đang bung và bảng nháy trắng sau mỗi lần gõ tìm.
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[]; total: number }>(
        `/api/v1/devices?${buildQuery(page, limit, filters, sorting)}`,
      ),
  });
  useClampPage(url, devices.data?.total);

  // Mọi bộ lọc đều đưa về trang 1 (hook tự xoá `page`): giữ nguyên trang 5 khi đổi lọc thì
  // bảng trông như rỗng. Đổi SITE thì bỏ luôn tủ đang chọn — tủ thuộc về site cũ.
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    if (key === 'siteId' && filters.cabinetId) url.setFilter('cabinetId', '');
    url.setFilter(key, value as string);
  };

  const cabinets = (lists.data?.cabinets ?? []).filter(
    (cabinet) => !filters.siteId || cabinet.siteId === filters.siteId,
  );
  const rows = devices.data?.items ?? [];

  /**
   * Máy nào đang cài license — hỏi MỘT lượt cho cả trang (không N+1) để biết dòng nào đáng
   * mọc mũi tên bung. Mũi tên bấm ra rỗng cũng là một kiểu hứa hão, đúng như bảng phần mềm
   * đã tránh.
   *
   * Hỏi qua module `software`: `devices` không được biết license là gì (AD-2).
   */
  const deviceIds = rows.map((row) => row.id);
  const installedCounts = useQuery({
    queryKey: ['software', 'installed', 'counts', deviceIds],
    enabled: deviceIds.length > 0,
    queryFn: () =>
      apiFetch<Record<string, number>>(
        `/api/v1/software/installed/counts?deviceIds=${deviceIds.join(',')}`,
      ),
  });

  /**
   * IP đang giữ của cả trang, một lượt, qua module `ipam` (AD-2). Chỉ là dòng phụ: hỏng thì
   * dòng phụ vắng, danh sách vẫn dùng được — không đáng một thông báo lỗi.
   */
  const heldIps = useQuery({
    queryKey: ['ipam', 'devices', 'addresses', deviceIds],
    enabled: deviceIds.length > 0,
    queryFn: () =>
      apiFetch<Record<string, string[]>>(
        `/api/v1/ipam/devices/addresses?deviceIds=${deviceIds.join(',')}`,
      ),
  });
  const ipsOf = heldIps.data;

  /**
   * `id` của cột PHẢI khớp whitelist `DEVICE_SORT_KEYS` phía API — đó là tên cột gửi lên
   * trong `?sort=`. Cột hiển thị qua danh mục (Loại, Vị trí) không sắp được: sắp theo chúng
   * đòi join sang bảng của module khác, vi phạm AD-2. Muốn theo site thì lọc rồi sắp theo mã.
   */
  const columns = useMemo<ColumnDef<DeviceRow, unknown>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('devices.code'),
        cell: ({ row }) => (
          <>
            {/* Link thật (không phải onClick trên <tr>): mở tab mới, copy link được. */}
            <Link className="mono" to={PATHS.device(row.original.id)}>
              {row.original.code}
            </Link>
            {/* IP là dòng phụ dưới mã, không phải cột riêng: ở 1280px thêm một cột là cột Tên
                bị ép. Nhiều IP thì hiện cái đầu + số còn lại. */}
            <IpSub ips={ipsOf?.[row.original.id]} />
          </>
        ),
      },
      {
        accessorKey: 'name',
        header: t('devices.name'),
        /* Loại và serial là dòng phụ dưới tên, không phải cột riêng: ở 1280px có sidebar, thêm
           một cột là cột Tên bị ép còn ~90px và nút Sửa bị đẩy khỏi khung. `col-name` giữ
           cho Tên luôn đủ rộng để đọc. */
        meta: { className: 'col-name' },
        /* Cả hai dòng đều MỘT dòng, cắt bằng "…" và đủ chữ ở `title`: tên dài gãy 3–4 dòng làm
           các hàng cao thấp lệch nhau, mắt không dò theo hàng được. Model đứng ngay sau loại vì
           đó là thứ người ta hỏi kế tiếp ("Switch gì?"). */
        cell: ({ row }) => {
          const d = row.original;
          const sub = [d.deviceTypeName, d.model].filter(Boolean).join(' · ');
          return (
            <>
              <span className="cell-clip" title={d.name}>
                {d.name}
              </span>
              <span
                className="cell-sub cell-clip"
                title={[sub, d.serial ? `S/N ${d.serial}` : null].filter(Boolean).join(' · ')}
              >
                {sub}
                {d.serial ? (
                  <>
                    {' · '}
                    <span className="mono">{d.serial}</span>
                  </>
                ) : null}
              </span>
            </>
          );
        },
      },
      {
        id: 'location',
        header: t('devices.locationCol'),
        cell: ({ row }) => <LocationText device={row.original} />,
      },
      {
        accessorKey: 'assignedTo',
        header: t('devices.assignedTo'),
        cell: ({ row }) => (
          <>
            {orDash(row.original.assignedTo)}
            {row.original.department ? (
              <span className="cell-sub">{row.original.department}</span>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: 'warrantyEnd',
        header: t('devices.warranty'),
        // AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts
        // `notCounted`: máy đã thanh lý thì bảo hành thôi có nghĩa — `findWarrantyExpiring` đã
        // loại nó ra, nên để huy hiệu kêu "Quá hạn" là hai màn nói ngược nhau.
        cell: ({ row }) => (
          <ExpiryBadge
            end={row.original.warrantyEnd}
            notCounted={row.original.status === 'retired'}
          />
        ),
      },
      {
        accessorKey: 'status',
        header: t('devices.status'),
        cell: ({ row }) => (
          <span className={`badge ${STATUS_TONE[row.original.status]}`}>
            {t(STATUS_KEY[row.original.status])}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        // Sửa NGAY TRÊN DANH SÁCH: đổi người giữ máy hay hạn bảo hành là việc lặt vặt
        // hằng ngày, bắt vào trang chi tiết rồi quay ra là ba lần chuyển trang cho một ô.
        // Mở đúng hộp "Thêm thiết bị" (AD-15) — cùng bộ trường, chỉ khác đã điền sẵn.
        // Thanh lý thì sang trang chi tiết: hộp thanh lý phải liệt kê thứ máy đang giữ (IP,
        // NAT, license…), và chỉ trang đó đọc đủ các khu ấy.
        cell: ({ row }) => (
          <DeviceRowActions
            device={row.original}
            onEdit={setEditing}
            onStatus={openStatus}
            onClone={setCloning}
            onRetire={(device) => navigate(`${PATHS.device(device.id)}?action=retire`)}
          />
        ),
      },
    ],
    [t, ipsOf, navigate, openStatus],
  );

  /* Điện thoại: thẻ gọn ~96px thay cho bảng xếp chồng 8 dòng/máy. Không có nút Sửa — form
     thiết bị là màn nhập desktop; chạm thẻ là mở chi tiết. */
  const mobileCard = useMemo<MobileCard<DeviceRow>>(
    () => ({
      title: (item) => <span className="mono">{item.code}</span>,
      href: (item) => PATHS.device(item.id),
      badge: (item) => (
        <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
      ),
      subtitle: (item) => item.name,
      meta: (item) =>
        [ipsOf?.[item.id]?.[0], item.siteCode ? locationLabel(item) : null, item.assignedTo]
          .filter(Boolean)
          .join(' · ') || null,
      aside: (item) => (
        <ExpiryBadge end={item.warrantyEnd} notCounted={item.status === 'retired'} />
      ),
    }),
    [t, ipsOf],
  );

  return (
    <>
      <PageHeader
        title={t('devices.title')}
        subtitle={t('devices.subtitle')}
        actions={
          <>
            {/* File mẫu là bước con của Nhập nên nằm TRONG hộp nhập, không đứng ngang hàng ở
                đây. Nhập Excel là màn desktop: trên điện thoại nút nhập ẩn đi (`hide-narrow`). */}
            {/* FR-028: xuất đúng bộ lọc VÀ đúng thứ tự đang xem — cùng query với bảng dưới. */}
            <ExportXlsxButton
              url={`/api/v1/devices/export?${[buildFilterQuery(filters), sortQuery(sorting)]
                .filter(Boolean)
                .join('&')}`}
              fileName="thiet-bi.xlsx"
            />
            <button
              type="button"
              className="btn hide-narrow"
              onClick={() => setImporting(true)}
            >
              {t('devices.importExcel')}
            </button>
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              {t('devices.add')}
            </button>
          </>
        }
      />

      <FilterBar
        search={url.searchInput}
        onSearchChange={url.setSearchInput}
        searchPlaceholder={t('devices.search')}
        activeCount={url.activeCount}
        onClear={url.clearFilters}
      >
        <Select
          value={filters.siteId}
          ariaLabel={t('devices.site')}
          placeholder={t('devices.allSites')}
          /* Menu "mã — tên" như form (người mới chưa thuộc mã site), nút đã chọn chỉ mã. */
          options={[
            { value: '', label: t('devices.allSites') },
            ...(lists.data?.sites ?? []).map((site) => ({
              value: site.id,
              label: `${site.code} — ${site.name}`,
              short: site.code,
            })),
          ]}
          failed={lists.isError}
          onChange={(value) => setFilter('siteId', value)}
        />
        <Select
          value={filters.cabinetId}
          ariaLabel={t('devices.cabinet')}
          placeholder={t('devices.allCabinets')}
          options={[
            { value: '', label: t('devices.allCabinets') },
            /* Chia theo site: menu chỉ còn mã tủ dưới tiêu đề site, nên hai tủ cùng hậu tố
               không bị cắt giữa mã thành hai dòng giống nhau. Nút đã chọn vẫn nói đủ site. */
            ...[...cabinets]
              .sort((a, b) => a.siteCode.localeCompare(b.siteCode))
              .map((cabinet) => ({
                value: cabinet.id,
                label: cabinet.code,
                short: `${cabinet.siteCode} · ${cabinet.code}`,
                searchText: `${cabinet.siteCode} ${cabinet.code}`,
                group: cabinet.siteCode,
              })),
          ]}
          failed={lists.isError}
          onChange={(value) => setFilter('cabinetId', value)}
        />
        <Select
          value={filters.deviceTypeId}
          ariaLabel={t('devices.type')}
          placeholder={t('devices.allTypes')}
          options={[
            { value: '', label: t('devices.allTypes') },
            ...(lists.data?.deviceTypes ?? []).map((type) => ({
              value: type.id,
              label: type.name,
            })),
          ]}
          failed={lists.isError}
          onChange={(value) => setFilter('deviceTypeId', value)}
        />
        <Select
          value={filters.status}
          ariaLabel={t('devices.status')}
          placeholder={statusOptions[0].label}
          options={statusOptions}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
      </FilterBar>

      {devices.isLoading ? (
        <Loading />
      ) : devices.isError ? (
        <LoadError error={devices.error} onRetry={() => void devices.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          /* HAI cảnh, HAI câu: "chưa khai gì" mời người dùng thêm bản ghi đầu tiên, "lọc không
             ra" mời họ nới bộ lọc. Một câu cho cả hai thì hệ thống vừa cài xong báo "không khớp
             bộ lọc" và người dùng đi tìm cái bộ lọc không tồn tại. Kèm NÚT làm đúng việc câu
             gợi ý nói, thay vì bắt người dùng đi tìm nút đó ở chỗ khác. */
          title={
            url.isFiltered
              ? url.search
                ? t('devices.emptySearch', { q: url.search })
                : t('devices.emptyFiltered')
              : t('devices.empty')
          }
          hint={url.isFiltered ? t('devices.emptyFilteredHint') : t('devices.emptyHint')}
          action={
            url.isFiltered ? (
              <button type="button" className="btn" onClick={url.clearFilters}>
                {t('devices.clearFilters')}
              </button>
            ) : (
              <>
                <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                  {t('devices.add')}
                </button>
                <button
                  type="button"
                  className="btn hide-narrow"
                  onClick={() => setImporting(true)}
                >
                  {t('devices.importExcel')}
                </button>
              </>
            )
          }
        />
      ) : (
        <div
          className={devices.isPlaceholderData ? 'list-refreshing' : undefined}
          aria-busy={devices.isPlaceholderData || undefined}
        >
          <DataTable
            data={rows}
            columns={columns}
            emptyText={url.isFiltered ? t('devices.emptyFiltered') : t('devices.empty')}
            stackOnMobile
            stickyActions
            mobileCard={mobileCard}
            rowClassName={(item) => (item.id === flashId ? 'row-flash' : '')}
            /* Bung dòng ra là thấy máy này đang cài license nào — cùng nếp với danh sách
               phần mềm. Chỉ hiện mũi tên khi thật sự có phần mềm đang cài. */
            /*
             * Hỏng thì MỌI dòng bung được, không phải KHÔNG dòng nào.
             *
             * `?? 0` biến một lỗi 500 thành "không máy nào đang cài phần mềm" — mũi tên biến
             * mất sạch và bảng trông hoàn toàn bình thường. Khi không biết máy nào có, để
             * người dùng bung ra xem là câu trả lời đúng: `DeviceLicensesExpand` có nhánh lỗi
             * riêng, nên bung ra sẽ thấy "không tải được" chứ không thấy một danh sách rỗng.
             */
            canExpand={(item) =>
              installedCounts.isError || (installedCounts.data?.[item.id] ?? 0) > 0
            }
            /* Mẫu bung dòng chuẩn (Q-18, Q-20, giống /software): khung `ExpandPanel` có đầu khu
               mang số đếm, bảng con bên dưới. Chưa đọc được số đếm thì bỏ số — đừng in "0" cho
               một máy có thể đang cài. */
            renderExpanded={(item) => (
              <ExpandPanel title={t('devices.installedTitle')} count={installedCounts.data?.[item.id]}>
                <DeviceLicensesExpand deviceId={item.id} />
              </ExpandPanel>
            )}
            manualSorting
            sorting={sorting}
            /* Bấm vào dòng là mở hồ sơ — nhắm trúng mã 12px là quá khó. Ô Mã vẫn là `<Link>`
               thật cho Ctrl+bấm / mở tab mới; `DataTable` bỏ qua lượt bấm rơi vào link/nút. */
            onRowClick={(item) => navigate(PATHS.device(item.id))}
            expandLabel={(item, open) => {
              const count = installedCounts.data?.[item.id];
              const what = count
                ? t('devices.licenseCount', { count })
                : t('devices.installedUnknown');
              return t(open ? 'devices.collapseInstalled' : 'devices.expandInstalled', {
                code: item.code,
                what,
              });
            }}
            onSortingChange={(updater) => {
              const next = typeof updater === 'function' ? updater(sorting) : updater;
              const first = next[0];
              // Đổi cột sắp xếp thì hook tự bỏ `page` khỏi URL: giữ nguyên trang 5 của thứ tự
              // CŨ là nhìn vào một lát cắt chẳng liên quan gì tới thứ tự vừa chọn.
              url.setSorting(first ? { key: String(first.id), desc: !!first.desc } : { key: 'code', desc: false });
            }}
          />

          <Pagination
            page={page}
            limit={limit}
            onLimitChange={setLimit}
            total={devices.data?.total ?? 0}
            onPageChange={setPage}
          />
        </div>
      )}

      {importing ? (
        <DeviceImportDialog
          csrfToken={me.csrfToken}
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false);
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
        />
      ) : null}

      {creating ? (
        <DeviceForm
          device={null}
          csrfToken={me.csrfToken}
          onClose={() => setCreating(false)}
          onSaved={(result, options) => {
            if (!options?.keepOpen) setCreating(false);
            setFlashId(result.device.id);
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
          onOpenCreated={(created) => navigate(PATHS.device(created.id))}
        />
      ) : null}

      {editing ? (
        // Cùng một `DeviceForm` với nút "Thêm thiết bị" — truyền `device` vào là nó tự đổi
        // sang PATCH và điền sẵn. AD-15: không có bản "form sửa" thứ hai để trôi lệch.
        <DeviceForm
          device={editing}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
        />
      ) : null}

      {cloning ? (
        <DeviceForm
          device={null}
          cloneFrom={cloning}
          csrfToken={me.csrfToken}
          onClose={() => setCloning(null)}
          onSaved={(result, options) => {
            if (!options?.keepOpen) setCloning(null);
            setFlashId(result.device.id);
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
          onOpenCreated={(created) => navigate(PATHS.device(created.id))}
        />
      ) : null}

      {statusOf ? (
        <StatusDialog
          code={statusOf.code}
          current={statusOf.status}
          reopen={statusOf.status === 'retired'}
          busy={setStatus.isPending}
          error={statusError}
          onCancel={() => setStatusOf(null)}
          onConfirm={(status) =>
            setStatus.mutate(
              { id: statusOf.id, status },
              {
                onSuccess: () => {
                  setStatusOf(null);
                  toast({ message: t('devices.statusChanged') });
                  void queryClient.invalidateQueries({ queryKey: ['devices'] });
                },
                onError: (err) => setStatusError(errorMessage(err)),
              },
            )
          }
        />
      ) : null}
    </>
  );
}

function IpSub({ ips }: { ips: string[] | undefined }) {
  const { t } = useTranslation();
  if (!ips || ips.length === 0) return null;
  return (
    <span className="cell-sub mono" title={ips.join(', ')}>
      {ips.length > 1 ? t('devices.ipMore', { ip: ips[0], count: ips.length - 1 }) : ips[0]}
    </span>
  );
}

function buildQuery(page: number, limit: number, filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  return [params.toString(), buildFilterQuery(filters), sortQuery(sorting)]
    .filter(Boolean)
    .join('&');
}

/**
 * Phần lọc (không kèm phân trang) — dùng CHUNG cho danh sách và cho nút Xuất Excel, nên
 * file xuất ra luôn khớp đúng cái đang nhìn thấy (FR-028).
 */
function buildFilterQuery(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.siteId) params.set('siteId', filters.siteId);
  if (filters.cabinetId) params.set('cabinetId', filters.cabinetId);
  if (filters.deviceTypeId) params.set('deviceTypeId', filters.deviceTypeId);
  // Mặc định ẩn máy đã thanh lý (Q-20): Kho thanh lý là nơi xem chúng. ⌘K không đi qua đây
  // nên vẫn tìm ra máy đã thanh lý.
  if (filters.status !== 'all') params.set('status', filters.status || 'live');
  return params.toString();
}
