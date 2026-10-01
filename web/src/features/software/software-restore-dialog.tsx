import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { addYearsIso } from '@/lib/add-years';
import { formatDate } from '@/lib/format';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { useFormErrors } from '@/ui/use-form-errors';
import { YearQuickPicks } from '@/ui/year-quick-picks';
import {
  formerDevices,
  isoDay,
  restoreEndReason,
  type FormerDevice,
} from './software-standing';
import { requiresEndDate, supportsSeats, type SoftwareRow } from './software-types';

/**
 * Khôi phục hồ sơ đã Thanh lý (Q-13).
 *
 * Bên trong vẫn là PATCH của Sửa hồ sơ (`status: active` + hạn mới), nên quyền, kiểm hạn và
 * lịch sử đi đúng đường cũ; hộp này chỉ gom ba việc người dùng phải tự nhớ: hạn mới từ hôm nay,
 * ghi chú, và gán lại các máy từng dùng (ghế đã gỡ KHÔNG tự quay lại). Gán lại đi qua API gán
 * ghế sẵn có, từng máy một: máy nào hỏng (đã thanh lý, hết ghế) thì báo riêng máy đó.
 */
export function RestoreDialog({
  software,
  csrfToken,
  onClose,
  onDone,
}: {
  software: SoftwareRow;
  csrfToken: string;
  onClose: () => void;
  /** `failures`: câu báo cho từng máy không gán lại được. */
  onDone: (result: { assigned: number; failures: string[] }) => void;
}) {
  const { t } = useTranslation();
  const today = isoDay(new Date());
  const perpetual = software.licenseModel === 'perpetual';
  const needsEnd =
    requiresEndDate(software.kind, software.licenseModel) ||
    (!perpetual && software.endDate !== null);
  const [endDate, setEndDate] = useState(needsEnd ? addYearsIso(today, 1) : '');
  const [note, setNote] = useState(software.note ?? '');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const hasSeats = supportsSeats(software.kind);

  const history = useQuery({
    queryKey: ['software', software.id, 'assignments', true],
    enabled: hasSeats,
    queryFn: () =>
      apiFetch<(FormerDevice & { releasedAt: string | null })[]>(
        `/api/v1/software/${software.id}/assignments?includeReleased=true`,
      ),
  });
  const devices = formerDevices(history.data ?? []);

  const endReason = perpetual ? null : restoreEndReason(endDate, today, needsEnd);
  const check = useFormErrors({
    endDate:
      endReason === 'required'
        ? t('software.restoreNeedEnd')
        : endReason === 'past'
          ? t('software.restorePastEnd')
          : null,
    devices:
      software.seatTotal !== null &&
      picked.size > software.seatTotal &&
      t('software.restoreTooMany', { total: software.seatTotal }),
  });

  const restore = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { status: 'active' };
      if (!perpetual && endDate) body.endDate = endDate;
      if (note.trim() !== (software.note ?? '')) body.note = note.trim();
      await apiFetch(`/api/v1/software/${software.id}`, {
        method: 'PATCH',
        csrfToken,
        body: JSON.stringify(body),
      });
      let assigned = 0;
      const failures: string[] = [];
      for (const device of devices.filter((entry) => picked.has(entry.deviceId))) {
        try {
          await apiFetch(`/api/v1/software/${software.id}/assignments`, {
            method: 'POST',
            csrfToken,
            body: JSON.stringify({ deviceId: device.deviceId }),
          });
          assigned += 1;
        } catch (err) {
          failures.push(
            t('software.restoreAssignFailed', { code: device.deviceCode, reason: errorMessage(err) }),
          );
        }
      }
      return { assigned, failures };
    },
  });

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!restore.isPending}
      guardUnsaved
      maxWidth={560}
      title={`${t('software.restoreTitle')} — ${software.code}`}
      footer={
        <>
          <DialogCancel>
            {t('common.cancel')}
          </DialogCancel>
          <button
            type="submit"
            form="restore-form"
            className="btn primary"
            disabled={restore.isPending}
          >
            {restore.isPending ? t('common.working') : t('software.restoreSubmit')}
          </button>
        </>
      }
    >
      <form
        id="restore-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          // Lỗi PATCH (hạn, quyền, ai đó vừa sửa) thì hồ sơ chưa đổi gì: báo ngay trong hộp.
          restore.mutate(undefined, {
            onSuccess: (result) => onDone(result),
            onError: (err) => setError(errorMessage(err)),
          });
        }}
      >
        <p className="muted span-2">{t('software.restoreIntro')}</p>

        {perpetual ? null : (
          <Field
            label={t('software.restoreEnd')}
            required={needsEnd}
            hint={
              software.endDate
                ? `${t('software.restoreEndHint')} ${t('software.endDate')}: ${formatDate(software.endDate)}.`
                : t('software.restoreEndHint')
            }
            error={check.error('endDate')}
          >
            <div className="row" style={{ gap: 'var(--space-3)' }}>
              <DatePicker
                value={endDate}
                ariaLabel={t('software.restoreEnd')}
                min={today}
                onChange={setEndDate}
              />
              <YearQuickPicks base={today} onPick={setEndDate} label={t('software.endQuick')} />
            </div>
          </Field>
        )}

        <Field label={t('software.restoreNote')} htmlFor="restore-note" hint={t('software.noteHint')}>
          <textarea
            id="restore-note"
            className="inp"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {hasSeats ? (
          <Field label={t('software.restoreDevices')} error={check.error('devices')}>
            {history.isLoading ? (
              <Loading />
            ) : history.isError ? (
              <LoadError error={history.error} onRetry={() => void history.refetch()} />
            ) : devices.length === 0 ? (
              <p className="muted">{t('software.restoreDevicesNone')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {devices.map((device) => (
                  <label key={device.deviceId} className="row" style={{ gap: 'var(--space-2)' }}>
                    <input
                      type="checkbox"
                      checked={picked.has(device.deviceId)}
                      onChange={() => toggle(device.deviceId)}
                    />
                    <span className="mono">{device.deviceCode}</span>
                    <small className="muted">{device.deviceName}</small>
                  </label>
                ))}
              </div>
            )}
          </Field>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
