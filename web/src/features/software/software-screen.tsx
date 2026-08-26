import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { UsageBar } from '@/ui/usage-bar';
import { LicenseSeatsExpand } from './license-seats-expand';
import { sortQuery } from '@/lib/sort-query';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import { AssignDialog } from './license-assignments-panel';
import { SoftwareForm } from './software-form';
import {
  KIND_KEY,
  SOFTWARE_KINDS,
  SOFTWARE_STATUSES,
  STATUS_KEY,
  STATUS_TONE,
  seatLabel,
  supportsSeats,
  type SoftwareKind,
  type SoftwareRow,
  type SoftwareStatus,
} from './software-types';

const LIMIT = 20;

interface Filters {
  search: string;
  kind: '' | SoftwareKind;
  status: '' | SoftwareStatus;
}

const EMPTY_FILTERS: Filters = { search: '', kind: '', status: '' };

/** Danh sách phần mềm (story 3.1, FR-008/FR-009) — lọc theo loại, cột tình trạng hạn. */
export function SoftwareScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Sắp xếp chạy ở SERVER (`manualSorting`): danh sách phân trang 20 dòng/trang, sắp ở client
  // chỉ đảo chỗ 20 dòng đang xem mà trông như đã sắp cả danh sách — sai mà không có dấu hiệu nào.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'code', desc: false }]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SoftwareRow | null>(null);
  const [assigning, setAssigning] = useState<SoftwareRow | null>(null);

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['software'] });

  const software = useQuery({
    queryKey: ['software', page, filters, sorting],
    queryFn: () =>
      apiFetch<{ items: SoftwareRow[]; total: number }>(
        `/api/v1/software?${buildQuery(page, filters, sorting)}`,
      ),
  });

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    // Đổi bộ lọc mà giữ nguyên trang 5 thì bảng trông như rỗng.
    setPage(1);
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
        cell: ({ row }) => (
          <Link className="mono" to={`/phan-mem/${row.original.id}`}>
            {row.original.code}
          </Link>
        ),
      },
      {
        accessorKey: 'name',
        header: t('software.name'),
        cell: ({ row }) => row.original.name,
      },
      {
        accessorKey: 'kind',
        header: t('software.kind'),
        cell: ({ row }) => t(KIND_KEY[row.original.kind]),
      },
      {
        id: 'vendorName',
        header: t('software.vendor'),
        cell: ({ row }) => orDash(row.original.vendorName),
      },
      {
        id: 'seats',
        header: t('software.seats'),
        cell: ({ row }) => {
          const item = row.original;
          // Thanh đo dùng chung (AD-15) — `SHARED-REGISTRY` ghi nó dành cho "dải IP, seat
          // license" ngay từ đầu, nhưng phần seat chưa bao giờ được nối. Con số trần "3/10"
          // bắt người đọc tự chia; thanh đo cho biết "gần đầy chưa" trong một cái liếc.
          if (!supportsSeats(item.kind) || item.seatTotal === null) {
            return <span className="mono">{seatLabel(item)}</span>;
          }
          return (
            <UsageBar
              percent={item.seatTotal === 0 ? 100 : (item.seatUsed / item.seatTotal) * 100}
              label={seatLabel(item)}
              ariaLabel={t('software.seats')}
            />
          );
        },
      },
      {
        accessorKey: 'endDate',
        header: t('software.expiry'),
        cell: ({ row }) =>
          row.original.licenseModel === 'perpetual' ? (
            // Mua đứt: nói thẳng "Vĩnh viễn". Để badge hạn ở đây thì hoặc hiện "Không có
            // hạn" (nghe như thiếu dữ liệu), hoặc trống trơn — cả hai đều làm người đọc
            // dừng lại tự hỏi, trong khi đây là trạng thái hoàn toàn bình thường.
            <span className="badge ok plain">{t('software.perpetual')}</span>
          ) : (
            // AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts
            <ExpiryBadge end={row.original.endDate} />
          ),
      },
      {
        accessorKey: 'status',
        header: t('software.status'),
        cell: ({ row }) => (
          <span className={`badge ${STATUS_TONE[row.original.status]}`}>
            {t(STATUS_KEY[row.original.status])}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => {
          const item = row.original;
          return (
            // Sửa và Gán NGAY TRÊN DANH SÁCH, cùng nếp với màn thiết bị: đổi hạn hay nhét key
            // vào một máy là việc lặt vặt hằng ngày, bắt vào trang chi tiết rồi quay ra là ba
            // lần chuyển trang cho một ô. Cả hai mở ĐÚNG hộp cũ (`SoftwareForm`,
            // `AssignDialog`) — AD-15 cấm bản thứ hai, hai bản sẽ trôi khác nhau đúng lúc
            // luật vượt seat đổi.
            <div className="action-cell">
              <button
                type="button"
                className="btn sm"
                aria-label={t('software.editOf', { code: item.code })}
                onClick={(event) => {
                  event.stopPropagation();
                  setEditing(item);
                }}
              >
                {t('common.edit')}
              </button>
              {/* Chỉ license mới có ghế để gán. SSL hay tên miền thì nút này vô nghĩa —
                  bày ra để bấm vào rồi báo lỗi là một kiểu hứa hão. */}
              {supportsSeats(item.kind) ? (
                <button
                  type="button"
                  className="btn sm"
                  aria-label={t('license.assignOf', { code: item.code })}
                  onClick={(event) => {
                    event.stopPropagation();
                    setAssigning(item);
                  }}
                >
                  {t('license.assign')}
                </button>
              ) : null}
            </div>
          );
        },
      },
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        title={t('software.title')}
        subtitle={t('software.subtitle')}
        actions={
          <>
            {/* FR-028: xuất đúng bộ lọc VÀ đúng thứ tự đang xem — cùng query với bảng dưới. */}
            <ExportXlsxButton
              url={`/api/v1/software/export.xlsx?${[buildFilterQuery(filters), sortQuery(sorting)]
                .filter(Boolean)
                .join('&')}`}
              fileName="phan-mem.xlsx"
            />
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            {t('software.add')}
          </button>
          </>
        }
      />

      <FilterBar
        search={filters.search}
        onSearchChange={(value) => setFilter('search', value)}
        searchPlaceholder={t('software.search')}
      >
        <Select
          value={filters.kind}
          ariaLabel={t('software.kind')}
          placeholder={t('software.allKinds')}
          options={[
            { value: '', label: t('software.allKinds') },
            ...SOFTWARE_KINDS.map((kind) => ({ value: kind, label: t(KIND_KEY[kind]) })),
          ]}
          onChange={(value) => setFilter('kind', value as Filters['kind'])}
        />
        <Select
          value={filters.status}
          ariaLabel={t('software.status')}
          placeholder={t('software.allStatuses')}
          options={[
            { value: '', label: t('software.allStatuses') },
            ...SOFTWARE_STATUSES.map((status) => ({
              value: status,
              label: t(STATUS_KEY[status]),
            })),
          ]}
          onChange={(value) => setFilter('status', value as Filters['status'])}
        />
      </FilterBar>

      {software.isLoading ? (
        <Loading />
      ) : software.isError ? (
        <LoadError onRetry={() => void software.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('software.empty')} hint={t('software.emptyHint')} />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            emptyText={t('software.empty')}
            stackOnMobile
            /* Bung dòng ra là thấy MÁY NÀO đang dùng key (AC 3.2 + nếp QLTS, AD-12). Chỉ
               license mới có seat, và chỉ hiện mũi tên khi thật sự có máy đang dùng — mũi
               tên bấm ra rỗng là một kiểu hứa hão khác. */
            canExpand={(item) => supportsSeats(item.kind) && item.seatUsed > 0}
            renderExpanded={(item) => (
              <LicenseSeatsExpand software={item} csrfToken={me.csrfToken} />
            )}
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
            limit={LIMIT}
            total={software.data?.total ?? 0}
            onPageChange={setPage}
          />
        </>
      )}

      {creating ? (
        <SoftwareForm
          row={null}
          lists={lists.data}
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
          lists={lists.data}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {assigning ? (
        <AssignDialog
          software={assigning}
          csrfToken={me.csrfToken}
          onClose={() => setAssigning(null)}
          onDone={(warnings) => {
            setAssigning(null);
            toast({ message: t('license.assigned') });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function buildQuery(page: number, filters: Filters, sorting: SortingState): string {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
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
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.status) params.set('status', filters.status);
  return params.toString();
}
