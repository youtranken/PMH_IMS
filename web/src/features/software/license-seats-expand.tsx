import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { ExpandHeader } from '@/ui/expand-header';
import { useToast } from '@/ui/toast';
import { AssignDialog } from './assign-dialog';
import { SeatTable, type SeatRow } from './seat-table';
import { seatFlag } from './software-standing';
import { seatLabel, supportsSeats, type SoftwareRow } from './software-types';

/**
 * Khu bung ra dưới một dòng license: bảng ghế gọn (`SeatTable compact`) — CÙNG bảng với tab
 * Máy đang dùng, để hai chỗ trả lời "máy nào dùng license này" giống hệt nhau (AD-15).
 *
 * Chỉ lấy ghế CÒN HIỆU LỰC: "key này từng nhập máy nào" là câu hỏi khác, đã có ở trang chi
 * tiết với nút "Đã gỡ" — không kéo lịch sử vào chỗ tra nhanh. License chưa có ghế nào vẫn bung
 * được: đó chính là lúc cần nút "Gán vào máy" ngay tại đây.
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
  const queryClient = useQueryClient();
  const [assigning, setAssigning] = useState(false);

  const seats = useQuery({
    queryKey: ['software', software.id, 'assignments', false],
    queryFn: () =>
      apiFetch<SeatRow[]>(`/api/v1/software/${software.id}/assignments?includeReleased=false`),
  });

  const rows = seats.data ?? [];
  // Hết ghế vẫn cho gán (có cảnh báo + ghi lý do, AC 3.2) — nút không tự khoá.
  const canAssign = supportsSeats(software.kind) && software.status !== 'retired';
  const flag = seatFlag(software.seatUsed, software.seatTotal);

  return (
    <div className="exp-soft">
      {/* Số đếm cùng con số với cột Ghế của bảng trên, lấy từ cùng một chỗ (`seatLabel`). */}
      <ExpandHeader
        title={t('license.seatsInUse')}
        count={seatLabel(software)}
        note={
          flag
            ? flag.over > 0
              ? t('software.seatsOver', { count: flag.over })
              : t('software.seatsFull')
            : undefined
        }
        action={canAssign ? { label: t('license.assign'), onClick: () => setAssigning(true) } : undefined}
      />

      {seats.isLoading ? (
        <p className="muted">{t('app.loading')}</p>
      ) : seats.isError ? (
        <p className="muted">{t('app.loadError')}</p>
      ) : rows.length === 0 ? (
        <p className="seat-empty">{t('license.emptySeats')}</p>
      ) : (
        <SeatTable software={software} rows={rows} csrfToken={csrfToken} compact />
      )}

      {assigning ? (
        <AssignDialog
          software={software}
          csrfToken={csrfToken}
          onClose={() => setAssigning(false)}
          onDone={(warnings, count) => {
            setAssigning(false);
            toast({ message: t('license.assignedCount', { count }) });
            warnings.forEach((message) => toast({ message, tone: 'warn' }));
            void queryClient.invalidateQueries({ queryKey: ['software'] });
          }}
        />
      ) : null}
    </div>
  );
}
