import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { useToast } from '@/ui/toast';
import { AssignDialog } from './assign-dialog';
import { SeatTable, type SeatRow } from './seat-table';
import { SeatUsage } from './software-standing-cell';
import { supportsSeats, type SoftwareRow, type SoftwareSeat } from './software-types';

/**
 * Máy đang dùng key (FR-011).
 *
 * Mặc định chỉ hiện ghế CÒN HIỆU LỰC; nút "Đã gỡ" mới thấy lịch sử — "key này từng nhập máy
 * nào" là câu hỏi lúc rà license, không được mất, nhưng cũng không nên chen vào danh sách hằng
 * ngày. Một lượt tải lấy cả hai để nút lọc mang được số đếm của cả hai phía.
 */
export function LicenseAssignmentsPanel({
  software,
  seats = [],
  autoAssign = false,
  onAutoAssignUsed,
  csrfToken,
}: {
  software: SoftwareRow;
  /** Ghế riêng của hồ sơ (Q-27) — ghế trống hiện dưới bảng, kèm nút gán. */
  seats?: SoftwareSeat[];
  /** `?assign=1` ("Lưu rồi gán vào máy"): mở sẵn hộp Gán. */
  autoAssign?: boolean;
  /** Đã mở hộp theo `autoAssign` — nơi gọi gỡ `?assign=1`, nếu không đổi tab / F5 là hộp bật lại. */
  onAutoAssignUsed?: () => void;
  csrfToken: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'active' | 'released'>('active');
  const [assigning, setAssigning] = useState(false);
  /* Theo dõi `autoAssign` chứ không chỉ đọc lúc dựng: chuyển sang hồ sơ khác mà panel vẫn đang
     mở (đợt mua mới → "Lưu rồi gán") thì không dựng lại, cờ chỉ đổi. */
  useEffect(() => {
    if (!autoAssign) return;
    if (software.status !== 'retired') setAssigning(true);
    onAutoAssignUsed?.();
  }, [autoAssign]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Ghế trống mà người dùng bấm "Gán" ở dòng của nó — máy đầu tiên vào đúng ghế đó. */
  const [preferredSeat, setPreferredSeat] = useState<string | null>(null);

  const assignments = useQuery({
    queryKey: ['software', software.id, 'assignments', true],
    queryFn: () =>
      apiFetch<SeatRow[]>(`/api/v1/software/${software.id}/assignments?includeReleased=true`),
  });

  if (!supportsSeats(software.kind)) {
    return <p className="muted">{t('license.onlyLicense')}</p>;
  }

  const all = assignments.data ?? [];
  const active = all.filter((row) => !row.releasedAt);
  const released = all.filter((row) => row.releasedAt);
  const rows = view === 'active' ? active : released;
  const noSeatYet = assignments.isSuccess && view === 'active' && active.length === 0;
  // API từ chối gán vào hồ sơ đã thanh lý (SOFTWARE_RETIRED): đừng bày nút để bấm rồi hỏng.
  // Mọi vai trò đều được gán, nên trạng thái hồ sơ là cửa duy nhất.
  const canAssign = software.status !== 'retired';

  return (
    <div className="attachment-panel">
      <div className="seat-toolbar">
        <SeatUsage item={software} />
        <div className="segmented" role="group" aria-label={t('license.filterState')}>
          <button
            type="button"
            aria-pressed={view === 'active'}
            onClick={() => setView('active')}
          >
            {t('license.tabActive')} <span className="seg-count">{active.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === 'released'}
            onClick={() => setView('released')}
          >
            {t('license.tabReleased')} <span className="seg-count">{released.length}</span>
          </button>
        </div>
        <span className="spacer" />
        {/* File nộp kiểm toán: máy ĐANG dùng + dòng tổng chi phí (API dựng) — không có ghế thì thôi. */}
        {active.length > 0 ? (
          <ExportXlsxButton
            url={`/api/v1/software/${software.id}/assignments/export.xlsx`}
            fileName={`may-dang-dung-${software.code}.xlsx`}
            label={t('license.exportDevices')}
          />
        ) : null}
        {/* Nút thường, không primary: màn chi tiết đã có "Sửa hồ sơ" là điểm nhấn duy nhất.
            Chưa gán máy nào thì nút nằm trong khối trống ngay bên dưới — hai nút cùng tên
            cách nhau một dòng là thừa. */}
        {noSeatYet || !canAssign ? null : (
          <button type="button" className="btn" onClick={() => setAssigning(true)}>
            {t('license.assign')}
          </button>
        )}
      </div>

      {assignments.isLoading ? (
        <Loading />
      ) : assignments.isError ? (
        <LoadError error={assignments.error} onRetry={() => void assignments.refetch()} />
      ) : rows.length === 0 ? (
        view === 'active' ? (
          <EmptyState
            title={t('license.empty')}
            hint={t('license.emptyHint')}
            action={
              canAssign ? (
                <button type="button" className="btn primary" onClick={() => setAssigning(true)}>
                  {t('license.assign')}
                </button>
              ) : undefined
            }
          />
        ) : (
          <p className="muted">{t('license.emptyReleased')}</p>
        )
      ) : (
        <SeatTable software={software} rows={rows} csrfToken={csrfToken} />
      )}

      {/* Ghế riêng còn trống (Q-27): thấy ngay ghế nào chưa có máy, hợp đồng nào đang nằm không. */}
      {view === 'active' && software.perSeat && seats.some((seat) => !seat.deviceId) ? (
        <section className="free-seats" aria-label={t('license.freeSeats')}>
          <h3 className="free-seats-title">{t('license.freeSeats')}</h3>
          <table className="table table-sub table-cards">
            <thead>
              <tr>
                <th>{t('software.seatCol')}</th>
                <th>{t('software.seatContract')}</th>
                <th>{t('software.seatNote')}</th>
                <th className="col-center">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {seats
                .filter((seat) => !seat.deviceId)
                .map((seat) => (
                  <tr key={seat.id}>
                    <td className="seat-no">{t('software.seatLabel', { n: seat.seatNo })}</td>
                    <td className="mono">{seat.contract ?? '—'}</td>
                    <td>{seat.note ?? '—'}</td>
                    <td className="col-center">
                      {canAssign ? (
                        <button
                          type="button"
                          className="btn sm"
                          aria-label={t('license.assignToSeat', { n: seat.seatNo })}
                          onClick={() => {
                            setPreferredSeat(seat.id);
                            setAssigning(true);
                          }}
                        >
                          {t('license.assign')}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {assigning ? (
        <AssignDialog
          software={software}
          preferredSeatId={preferredSeat ?? undefined}
          csrfToken={csrfToken}
          onClose={() => {
            setAssigning(false);
            setPreferredSeat(null);
          }}
          onDone={(warnings, count) => {
            setAssigning(false);
            setPreferredSeat(null);
            toast({ message: t('license.assignedCount', { count }) });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void queryClient.invalidateQueries({ queryKey: ['software'] });
          }}
        />
      ) : null}
    </div>
  );
}
