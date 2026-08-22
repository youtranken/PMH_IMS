import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime, orDash } from '@/lib/format';
import { Combobox } from '@/ui/combobox';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import type { DeviceRow } from '@/features/devices/device-types';
import { seatLabel, supportsSeats, type SoftwareRow } from './software-types';

interface AssignmentRow {
  id: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  assignedBy: string;
  assignedAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  overSeatReason: string | null;
  note: string | null;
}

/**
 * Máy đang dùng key (story 3.2, FR-011).
 *
 * Mặc định chỉ hiện bản ghi CÒN HIỆU LỰC; bật "xem cả đã gỡ" mới thấy lịch sử đầy đủ —
 * "key này từng nhập máy nào" là câu hỏi lúc rà license, không được mất, nhưng cũng không
 * nên chen vào danh sách hằng ngày.
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
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [showReleased, setShowReleased] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const queryKey = ['software', software.id, 'assignments', showReleased];
  const assignments = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<AssignmentRow[]>(
        `/api/v1/software/${software.id}/assignments?includeReleased=${String(showReleased)}`,
      ),
  });

  const release = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/software/${software.id}/assignments/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['software'] });

  if (!supportsSeats(software.kind)) {
    return <p className="muted">{t('license.onlyLicense')}</p>;
  }

  const rows = assignments.data ?? [];

  return (
    <div className="attachment-panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted">
          {t('software.seats')}: <span className="mono">{seatLabel(software)}</span>
        </span>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <button type="button" className="btn sm" onClick={() => setShowReleased((v) => !v)}>
            {t(showReleased ? 'license.hideReleased' : 'license.showReleased')}
          </button>
          <button type="button" className="btn primary" onClick={() => setAssigning(true)}>
            {t('license.assign')}
          </button>
        </div>
      </div>

      {assignments.isLoading ? (
        <Loading />
      ) : assignments.isError ? (
        <LoadError onRetry={() => void assignments.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('license.empty')} hint={t('license.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('license.device')}</th>
                <th>{t('license.assignedAt')}</th>
                <th>{t('license.note')}</th>
                <th>{t('license.state')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.releasedAt ? 'row-muted' : undefined}>
                  <td data-label={t('license.device')}>
                    <Link className="mono" to={`/thiet-bi/${row.deviceId}`}>
                      {row.deviceCode}
                    </Link>
                    <span className="cell-sub">{row.deviceName}</span>
                  </td>
                  <td data-label={t('license.assignedAt')}>
                    {formatDateTime(row.assignedAt)}
                    <span className="cell-sub">{row.assignedBy}</span>
                  </td>
                  <td data-label={t('license.note')}>
                    {orDash(row.note)}
                    {row.overSeatReason ? (
                      <span className="cell-sub">
                        {t('license.overSeatReason')}: {row.overSeatReason}
                      </span>
                    ) : null}
                  </td>
                  <td data-label={t('license.state')}>
                    {row.releasedAt ? (
                      <span className="badge muted">
                        {t('license.released')} {formatDateTime(row.releasedAt)}
                      </span>
                    ) : (
                      <span className="badge ok">{t('license.active')}</span>
                    )}
                  </td>
                  <td>
                    {row.releasedAt ? null : (
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() => {
                          void (async () => {
                            const ok = await askConfirm({
                              message: t('license.confirmRelease', { device: row.deviceCode }),
                              danger: true,
                            });
                            if (!ok) return;
                            release.mutate(
                              { id: row.id },
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
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning ? (
        <AssignDialog
          software={software}
          csrfToken={csrfToken}
          onClose={() => setAssigning(false)}
          onDone={(warnings) => {
            setAssigning(false);
            toast({ message: t('license.assigned') });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function AssignDialog({
  software,
  csrfToken,
  onClose,
  onDone,
}: {
  software: SoftwareRow;
  csrfToken: string;
  onClose: () => void;
  onDone: (warnings: string[]) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [device, setDevice] = useState<{ id: string; code: string } | null>(null);
  const [note, setNote] = useState('');
  const [overSeatReason, setOverSeatReason] = useState('');
  const [needReason, setNeedReason] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&search=${encodeURIComponent(debounced.trim())}`,
      ),
  });

  const assign = useApiMutation<Record<string, unknown>, { warnings: string[] }>(
    `/api/v1/software/${software.id}/assignments`,
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog open onOpenChange={onClose} maxWidth={560}>
      <DialogTitle>
        {t('license.assignTitle')} — {software.code}
      </DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!device) {
            setError(t('license.pickDevice'));
            return;
          }
          assign.mutate(
            {
              deviceId: device.id,
              note: note.trim(),
              overSeatReason: overSeatReason.trim(),
            },
            {
              onSuccess: (result) => onDone(result.warnings ?? []),
              onError: (err) => {
                // Hết seat: KHÔNG chặn hẳn — mở ô lý do rồi cho gửi lại (AC 3.2).
                if (errorCode(err) === 'SEAT_LIMIT_REACHED') setNeedReason(true);
                setError(errorMessage(err));
              },
            },
          );
        }}
      >
        <p className="muted">
          {t('software.seats')}: <span className="mono">{seatLabel(software)}</span>
        </p>

        <Field label={t('license.device')} required hint={t('license.deviceHint')}>
          <Combobox
            placeholder={t('license.deviceSearch')}
            query={query}
            onQuery={(value) => {
              setQuery(value);
              // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện tên A mà id vẫn là B.
              setDevice(null);
            }}
            options={candidates.data?.items ?? []}
            getKey={(item) => item.id}
            renderOption={(item) => (
              <>
                <span className="mono">{item.code}</span> <small>{item.name}</small>
              </>
            )}
            onSelect={(item) => {
              setDevice({ id: item.id, code: item.code });
              setQuery(item.code);
            }}
          />
        </Field>

        <Field label={t('license.note')} htmlFor="assign-note">
          <input
            id="assign-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {needReason ? (
          <Field
            label={t('license.overSeatReason')}
            required
            hint={t('license.overSeatHint')}
            htmlFor="assign-reason"
          >
            <input
              id="assign-reason"
              className="inp"
              value={overSeatReason}
              onChange={(e) => setOverSeatReason(e.target.value)}
            />
          </Field>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={assign.isPending}>
            {assign.isPending ? t('common.loading') : t('license.assign')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
