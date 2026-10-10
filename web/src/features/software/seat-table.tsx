import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { PATHS } from '@/lib/routes';
import { useConfirm } from '@/ui/confirm-provider';
import { CellNote } from '@/ui/cell-note';
import { TableWrap } from '@/ui/data-table';
import { RowActions } from '@/ui/row-actions';
import { useToast } from '@/ui/toast';
import { AssignDialog } from './assign-dialog';
import { SeatEndCell } from './seat-cells';
import type { LicenseSeat, SoftwareRow } from './software-types';

/** Một ghế, kèm phần chỉ tab Máy đang dùng mới có (ghế đã gỡ, lý do vượt ghế). */
export interface SeatRow extends LicenseSeat {
  releasedBy?: string | null;
  releasedAt?: string | null;
  overSeatReason?: string | null;
}

/**
 * Bảng ghế của MỘT license — dùng chung cho khu bung dòng ở danh sách và tab Máy đang dùng,
 * để hai chỗ trả lời "máy nào dùng license này" bằng cùng một bảng (AD-15).
 *
 * `compact` (khu bung): bỏ dòng "gán lúc · ai gán", và cột Chi phí mà mọi ghế đều trống thì không
 * vẽ — cột toàn "—" chỉ đẩy nút thao tác ra ngoài khung. Cột Ghi chú luôn vẽ (Q-24). Cột thao tác
 * dính mép phải khi bảng phải cuộn ngang. Mang kiểu bảng con `table-sub` như mọi bảng trong
 * khu bung dòng (Q-20).
 *
 * Là `<table>` thật (không phải lưới div) để trình đọc màn hình gắn được tiêu đề cột.
 */
export function SeatTable({
  software,
  rows,
  csrfToken,
  compact = false,
}: {
  software: SoftwareRow;
  rows: SeatRow[];
  csrfToken: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SeatRow | null>(null);

  const release = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/software/${software.id}/assignments/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );
  // Làm mới cả danh sách (cột Ghế) lẫn khu bung / tab.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['software'] });

  // Chỉ khu bung mới giấu cột Chi phí khi trống; tab đầy đủ luôn có chỗ để đối chiếu. Cột Ghi
  // chú thì LUÔN có (Q-24): ghi chú là thứ người ta đọc lướt cả bảng, giấu đi là mất.
  const showCost = !compact || rows.some((row) => row.cost !== null);
  const active = rows.filter((row) => !row.releasedAt);
  const totalCost = active.reduce((sum, row) => sum + (row.cost ?? 0), 0);

  const onRelease = async (row: SeatRow) => {
    const ok = await askConfirm({
      title: t('common.titleOf', { action: t('license.release'), subject: row.deviceCode }),
      message: t('license.confirmRelease', { device: row.deviceCode }),
      danger: true,
      confirmLabel: t('license.release'),
    });
    if (!ok) return;
    release.mutate(
      { id: row.id },
      {
        onSuccess: () => {
          toast({ message: t('license.releasedDone') });
          void refresh();
        },
        onError: (error) => toast({ message: errorMessage(error), tone: 'error' }),
      },
    );
  };

  return (
    <>
      <TableWrap>
        <table className="table table-stack table-sub table-cards seat-table">
          <thead>
            <tr>
              <th>{t('license.device')}</th>
              {showCost ? <th className="num">{t('license.cost')}</th> : null}
              <th>{t('license.term')}</th>
              <th>{t('license.note')}</th>
              <th className="col-center col-sticky-end">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.releasedAt ? 'row-muted' : undefined}>
                <td data-label={t('license.device')}>
                  <Link className="mono" to={PATHS.device(row.deviceId)}>
                    {row.deviceCode}
                  </Link>
                  <span className="cell-sub">
                    {[row.seatNo ? t('software.seatLabel', { n: row.seatNo }) : null, row.deviceName, row.deviceAssignedTo ? t('license.deviceUser', { name: row.deviceAssignedTo }) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {row.releasedAt ? (
                    <span className="cell-sub">
                      <span className="badge muted">
                        {t('license.releasedOn', {
                          date: formatDate(row.releasedAt),
                          by: row.releasedBy ?? '',
                        })}
                      </span>
                    </span>
                  ) : compact ? null : (
                    <span className="cell-sub">
                      {t('license.assignedAt')} {formatDateTime(row.assignedAt)} · {row.assignedBy}
                    </span>
                  )}
                </td>
                {showCost ? (
                  <td className="num" data-label={t('license.cost')}>
                    {formatMoney(row.cost)}
                  </td>
                ) : null}
                <td data-label={t('license.term')}>
                  <SeatEndCell
                    seat={row}
                    licenseModel={software.licenseModel}
                    fallbackEnd={software.endDate}
                  />
                  {row.startDate ? (
                    <span className="cell-sub">
                      {t('license.termFrom', { date: formatDate(row.startDate) })}
                    </span>
                  ) : null}
                  {/* Hợp đồng là dòng phụ của Kỳ hạn — hai thứ đi cùng lúc đối chiếu quyết toán,
                      và nhường cột cho Ghi chú để bảng vẫn vừa 1366px. */}
                  {row.contract ? (
                    <span className="cell-sub">
                      {t('license.contract')}: <span className="mono">{row.contract}</span>
                    </span>
                  ) : null}
                </td>
                <td
                  data-label={t('license.note')}
                  data-empty={row.note || row.overSeatReason ? undefined : true}
                >
                  {row.note ? <CellNote text={row.note} /> : null}
                  {row.overSeatReason ? (
                    <span className="cell-sub">
                      {t('license.overSeatReason')}: {row.overSeatReason}
                    </span>
                  ) : null}
                  {row.note || row.overSeatReason ? null : <span className="muted">—</span>}
                </td>
                <td className="col-center col-sticky-end" data-label={t('common.actions')}>
                  {/* "Gỡ" nằm trong menu, không đứng cạnh "Sửa": hai nút sát nhau thì trượt tay
                      một ô là thu license khỏi một máy đang dùng. */}
                  {row.releasedAt ? null : (
                    <RowActions
                        primary={{
                          label: t('common.edit'),
                          ariaLabel: t('common.editOf', { subject: row.deviceCode }),
                          onClick: () => setEditing(row),
                        }}
                        label={t('common.actionsOf', { subject: row.deviceCode })}
                        items={[
                          {
                            key: 'release',
                            label: t('license.release'),
                            danger: true,
                            disabled: release.isPending,
                            onSelect: () => void onRelease(row),
                          },
                        ]}
                      />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      {!compact && totalCost > 0 ? (
        <p className="muted seat-total">
          {t('license.totalCost', { count: active.length, total: formatMoney(totalCost) })}
        </p>
      ) : null}

      {editing ? (
        <AssignDialog
          software={software}
          seat={editing}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            // Toast phải GỌI TÊN thứ vừa đổi: "Đã lưu" trên màn có 10 ghế thì không biết ghế nào.
            toast({ message: t('license.seatSaved', { device: editing.deviceCode }) });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}
