import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { DataTable } from '@/ui/data-table';
import { LoadError } from '@/ui/load-state';
import { DetailSection } from '@/ui/detail-layout';

/** Một dòng sổ gia hạn (`renewal_history`, chủ là module expiry) — `GET /software/:id/renewals`. */
export interface RenewalRow {
  id: string;
  oldEnd: string | null;
  newEnd: string;
  contract: string | null;
  /** Tiền đồng; null = chưa khai (khác 0 ₫). */
  cost: number | null;
  /** Website của RIÊNG kỳ này (SSL/tên miền); null = loại hồ sơ không có website. */
  websites: string[] | null;
  actor: string;
  createdAt: string;
}

/**
 * Sổ gia hạn của một hồ sơ: mỗi lượt một dòng, kèm hợp đồng + chi phí của RIÊNG lượt đó (Q-15).
 * Tab Lịch sử chỉ nói "gia hạn tới X"; câu quyết toán "năm nay gia hạn theo hợp đồng nào, hết
 * bao nhiêu" đọc ở bảng này.
 */
export function SoftwareRenewals({
  softwareId,
  withWebsites = false,
}: {
  softwareId: string;
  /** SSL / tên miền: thêm cột website của từng kỳ — "năm 2025 cert này phủ website nào". */
  withWebsites?: boolean;
}) {
  const { t } = useTranslation();
  const renewals = useQuery({
    queryKey: ['software', softwareId, 'renewals'],
    queryFn: () => apiFetch<RenewalRow[]>(`/api/v1/software/${softwareId}/renewals`),
  });
  const blank = t('history.blank');
  const columns: ColumnDef<RenewalRow, unknown>[] = [
    {
      id: 'createdAt',
      accessorKey: 'createdAt',
      header: t('software.renewalAt'),
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      id: 'period',
      header: t('software.renewalPeriod'),
      cell: ({ row }) => (
        <span className="mono">
          {row.original.oldEnd ? formatDate(row.original.oldEnd) : blank} →{' '}
          {formatDate(row.original.newEnd)}
        </span>
      ),
    },
    {
      id: 'contract',
      header: t('software.renewalContract'),
      cell: ({ row }) => row.original.contract ?? <span className="muted">{blank}</span>,
    },
    {
      id: 'cost',
      header: t('software.renewalCost'),
      // 0 ₫ là giá trị THẬT (gia hạn tặng kèm) — chỉ null mới là "chưa khai".
      cell: ({ row }) =>
        row.original.cost === null ? (
          <span className="muted">{blank}</span>
        ) : (
          formatMoney(row.original.cost)
        ),
    },
    ...(withWebsites
      ? [
          {
            id: 'websites',
            header: t('software.renewalWebsites'),
            cell: ({ row }) => sitesOf(row.original) || <span className="muted">{blank}</span>,
          } satisfies ColumnDef<RenewalRow, unknown>,
        ]
      : []),
    { id: 'actor', header: t('software.renewalActor'), cell: ({ row }) => row.original.actor },
  ];

  return (
    <DetailSection title={t('software.renewalsTitle')}>
      {renewals.isError ? (
        <LoadError error={renewals.error} onRetry={() => void renewals.refetch()} />
      ) : (
        <DataTable
          data={renewals.data ?? []}
          columns={columns}
          loading={renewals.isLoading}
          emptyText={t('software.renewalsEmpty')}
          mobileCard={{
            title: (row) =>
              `${row.oldEnd ? formatDate(row.oldEnd) : blank} → ${formatDate(row.newEnd)}`,
            subtitle: (row) =>
              [
                row.contract ?? t('software.renewalNoContract'),
                row.cost === null ? null : formatMoney(row.cost),
              ]
                .filter(Boolean)
                .join(' · '),
            meta: (row) =>
              [withWebsites ? sitesOf(row) : null, formatDateTime(row.createdAt), row.actor]
                .filter(Boolean)
                .join(' · '),
          }}
        />
      )}
    </DetailSection>
  );
}

function sitesOf(row: RenewalRow): string {
  return (row.websites ?? []).join(', ');
}
