import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, formatMoney, orDash } from '@/lib/format';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { AssignDialog } from './license-assignments-panel';
import { SeatEndCell } from './seat-cells';
import { seatLabel, supportsSeats, type LicenseSeat, type SoftwareRow } from './software-types';
import { PATHS } from '@/lib/routes';

/**
 * Khu bung ra dưới một dòng license: MỖI CHỖ NGỒI một thẻ, kèm chi phí, hợp đồng và kỳ hạn
 * riêng của chính ghế đó (AC 3.2 + nếp `seat-list` của code nền QLTS, AD-12).
 *
 * Vì sao là lưới thẻ chứ không phải bảng lồng: hàng bung nằm TRONG một ô của bảng cha; bảng
 * lồng bảng thì bề rộng cột trong ngoài giằng nhau, và ở dải tablet bảng cha đã gập thành
 * thẻ dọc còn bảng con thì chưa.
 *
 * Chỉ lấy bản ghi CÒN HIỆU LỰC: "key này từng nhập máy nào" là câu hỏi khác, đã có ở trang
 * chi tiết với ô "xem cả đã gỡ" — không kéo lịch sử vào chỗ tra nhanh.
 */
export function LicenseSeatsExpand({
  software,
  csrfToken,
}: {
  software: SoftwareRow;
  csrfToken: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<LicenseSeat | null>(null);

  const seats = useQuery({
    queryKey: ['software', software.id, 'assignments', false],
    queryFn: () =>
      apiFetch<LicenseSeat[]>(
        `/api/v1/software/${software.id}/assignments?includeReleased=false`,
      ),
  });

  const release = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/software/${software.id}/assignments/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  const rows = seats.data ?? [];
  // Hết seat vẫn cho gán (có cảnh báo + ghi lý do, AC 3.2) — nút không tự khoá.
  const canAssign = supportsSeats(software.kind);
  // Làm mới cả danh sách (cột seat) lẫn khu bung dòng.
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['software'] });

  return (
    <div className="exp-soft">
      <div className="seat-head">
        {/* "3/10 ghế đã gán" — cùng con số với cột Seat của bảng trên, lấy từ cùng một chỗ
            (`seatLabel`) nên không thể lệch nhau. */}
        <span>{t('license.seatsHeader', { seats: seatLabel(software) })}</span>
        <span className="spacer" />
        {canAssign ? (
          <button type="button" className="btn sm" onClick={() => setAssigning(true)}>
            {t('license.assign')}
          </button>
        ) : null}
      </div>

      {seats.isLoading ? (
        <p className="muted">{t('app.loading')}</p>
      ) : seats.isError ? (
        <p className="muted">{t('app.loadError')}</p>
      ) : rows.length === 0 ? (
        <p className="seat-empty">{t('license.emptySeats')}</p>
      ) : (
        <div className="seat-list">
          <div className="seat-hd">
            <span>{t('license.device')}</span>
            <span>{t('license.user')}</span>
            <span>{t('license.cost')}</span>
            <span>{t('license.startDate')}</span>
            <span>{t('license.endDate')}</span>
            <span>{t('license.contract')}</span>
            <span>{t('license.note')}</span>
            <span aria-hidden="true" />
          </div>
          {rows.map((seat) => (
            <div key={seat.id} className="seat-card">
              <div className="seat-mc" data-label={t('license.device')}>
                {/* Link thật (không phải onClick trên thẻ): mở tab mới, copy link được. */}
                <Link className="mono" to={PATHS.device(seat.deviceId)}>
                  {seat.deviceCode}
                </Link>
              </div>
              <div className="seat-who" data-label={t('license.user')} title={seat.deviceName}>
                {orDash(seat.deviceAssignedTo)}
              </div>
              <div className="seat-cost" data-label={t('license.cost')}>
                {formatMoney(seat.cost)}
              </div>
              <div className="seat-date" data-label={t('license.startDate')}>
                {seat.startDate ? formatDate(seat.startDate) : '—'}
              </div>
              <div className="seat-date" data-label={t('license.endDate')}>
                <SeatEndCell
                  seat={seat}
                  licenseModel={software.licenseModel}
                  fallbackEnd={software.endDate}
                />
              </div>
              <div className="seat-note" data-label={t('license.contract')} title={seat.contract ?? undefined}>
                {orDash(seat.contract)}
              </div>
              <div className="seat-note" data-label={t('license.note')} title={seat.note ?? undefined}>
                {orDash(seat.note)}
              </div>
              <div className="seat-menu">
                <button
                  type="button"
                  className="btn sm"
                  aria-label={t('license.editSeatOf', { device: seat.deviceCode })}
                  onClick={() => setEditing(seat)}
                >
                  {t('common.edit')}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={release.isPending}
                  aria-label={t('license.releaseSeatOf', { device: seat.deviceCode })}
                  onClick={() => {
                    void (async () => {
                      const ok = await askConfirm({
                        message: t('license.confirmRelease', { device: seat.deviceCode }),
                        danger: true,
                        confirmLabel: t('license.release'),
                      });
                      if (!ok) return;
                      release.mutate(
                        { id: seat.id },
                        {
                          onSuccess: () => {
                            toast({ message: t('license.releasedDone') });
                            void refresh();
                          },
                          onError: (error) =>
                            toast({ message: errorMessage(error), tone: 'error' }),
                        },
                      );
                    })();
                  }}
                >
                  {t('license.release')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {assigning ? (
        // Dùng LẠI đúng hộp của trang chi tiết (AD-15) — luật vượt seat, chặn gán trùng máy,
        // ô tìm máy, các ô chi phí/hợp đồng/kỳ hạn đều nằm trong đó, không chép bản thứ hai.
        <AssignDialog
          software={software}
          csrfToken={csrfToken}
          onClose={() => setAssigning(false)}
          onDone={(warnings) => {
            setAssigning(false);
            toast({ message: t('license.assigned') });
            warnings.forEach((message) => toast({ message, tone: 'warn' }));
            void refresh();
          }}
        />
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
    </div>
  );
}
