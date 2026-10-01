import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { useToast } from '@/ui/toast';
import { AssignDialog } from './assign-dialog';
import { SeatTable, type SeatRow } from './seat-table';
import { SeatUsage } from './software-standing-cell';
import { supportsSeats, type SoftwareRow } from './software-types';

/**
 * Máy đang dùng key (FR-011).
 *
 * Mặc định chỉ hiện ghế CÒN HIỆU LỰC; nút "Đã gỡ" mới thấy lịch sử — "key này từng nhập máy
 * nào" là câu hỏi lúc rà license, không được mất, nhưng cũng không nên chen vào danh sách hằng
 * ngày. Một lượt tải lấy cả hai để nút lọc mang được số đếm của cả hai phía.
 */
export function LicenseAssignmentsPanel({
  software,
  csrfToken,
}: {
  software: SoftwareRow;
  csrfToken: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'active' | 'released'>('active');
  const [assigning, setAssigning] = useState(false);

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
        {noSeatYet ? null : (
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
              <button type="button" className="btn primary" onClick={() => setAssigning(true)}>
                {t('license.assign')}
              </button>
            }
          />
        ) : (
          <p className="muted">{t('license.emptyReleased')}</p>
        )
      ) : (
        <SeatTable software={software} rows={rows} csrfToken={csrfToken} />
      )}

      {assigning ? (
        <AssignDialog
          software={software}
          csrfToken={csrfToken}
          onClose={() => setAssigning(false)}
          onDone={(warnings, count) => {
            setAssigning(false);
            toast({ message: t('license.assignedCount', { count }) });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void queryClient.invalidateQueries({ queryKey: ['software'] });
          }}
        />
      ) : null}
    </div>
  );
}
