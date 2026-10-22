import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import type { DeviceStatus } from '@/lib/device-types';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { useToast } from '@/ui/toast';
import { StatusDialog } from './status-dialog';

/**
 * Thanh thao tác của các máy đang tick (UX-E25): đổi trạng thái (không có Thanh lý — đi từng máy)
 * và đổi người dùng / phòng ban. Mỗi việc là MỘT lượt gọi API, một transaction cho cả lô.
 */
export function DeviceBulkBar({
  ids,
  csrfToken,
  onClear,
  onDone,
}: {
  ids: string[];
  csrfToken: string;
  onClear: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState<'status' | 'assign' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignedTo, setAssignedTo] = useState('');
  const [department, setDepartment] = useState('');
  const status = useApiMutation<{ ids: string[]; status: DeviceStatus }, { changed: number }>('/api/v1/devices/bulk/status', {
    csrfToken,
    refreshMe: false,
  });
  const update = useApiMutation<{ ids: string[]; assignedTo?: string; department?: string }, { updated: number }>(
    '/api/v1/devices/bulk/update',
    { csrfToken, refreshMe: false },
  );
  const subject = t('devices.bulkSubject', { count: ids.length });
  const close = () => {
    setOpen(null);
    setError(null);
    // Hủy rồi mở lại (có khi cho lô khác) không được điền sẵn chữ cũ và bật sẵn nút Lưu.
    setAssignedTo('');
    setDepartment('');
  };
  const finish = (message: string) => {
    toast({ message });
    close();
    onDone();
  };

  return (
    <>
      <StickyActionBar label={t('devices.bulkLabel')} note={t('devices.bulkSelected', { count: ids.length })}>
        <button type="button" className="btn" onClick={onClear}>
          {t('devices.bulkClear')}
        </button>
        <button type="button" className="btn" onClick={() => setOpen('assign')}>
          {t('devices.bulkAssign')}
        </button>
        <button type="button" className="btn primary" onClick={() => setOpen('status')}>
          {t('devices.changeStatus')}
        </button>
      </StickyActionBar>

      {open === 'status' ? (
        <StatusDialog
          code={subject}
          current={null}
          reopen={false}
          busy={status.isPending}
          error={error}
          onCancel={close}
          onConfirm={(next) =>
            status.mutate(
              { ids, status: next },
              {
                onSuccess: (result) => finish(t('devices.bulkStatusDone', { count: result.changed })),
                onError: (err) => setError(errorMessage(err)),
              },
            )
          }
        />
      ) : null}

      {open === 'assign' ? (
        <Dialog
          open
          onOpenChange={update.isPending ? () => undefined : close}
          dismissible={!update.isPending}
          maxWidth={480}
          title={t('common.titleOf', { action: t('devices.bulkAssign'), subject })}
          footer={
            <>
              <button type="button" className="btn" disabled={update.isPending} onClick={close}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={update.isPending || (!assignedTo.trim() && !department.trim())}
                onClick={() =>
                  update.mutate(
                    {
                      ids,
                      ...(assignedTo.trim() ? { assignedTo: assignedTo.trim() } : {}),
                      ...(department.trim() ? { department: department.trim() } : {}),
                    },
                    {
                      onSuccess: (result) => finish(t('devices.bulkAssignDone', { count: result.updated })),
                      onError: (err) => setError(errorMessage(err)),
                    },
                  )
                }
              >
                {t('common.save')}
              </button>
            </>
          }
        >
          {error ? (
            <p className="alert error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="muted">{t('devices.bulkAssignHint')}</p>
          <Field label={t('devices.assignedTo')} htmlFor="bulk-assigned-to">
            <input id="bulk-assigned-to" className="inp" value={assignedTo} maxLength={120} onChange={(e) => setAssignedTo(e.target.value)} />
          </Field>
          <Field label={t('devices.department')} htmlFor="bulk-department">
            <input id="bulk-department" className="inp" value={department} maxLength={120} onChange={(e) => setDepartment(e.target.value)} />
          </Field>
        </Dialog>
      ) : null}
    </>
  );
}
