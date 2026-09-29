import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { STATUS_KEY, type DeviceStatus } from '@/lib/device-types';

/** Trạng thái đổi được bằng hộp này. "Đã thanh lý" có hộp riêng (liệt kê thứ sẽ gỡ). */
const TARGETS: DeviceStatus[] = ['in_use', 'spare', 'broken'];

/**
 * Đổi trạng thái nhanh (Đang dùng · Dự phòng · Hỏng) — và mở lại hồ sơ đã thanh lý.
 *
 * Việc hay gặp nhất (máy hỏng, đem máy về kho) không được bắt mở form Sửa 15 ô. Mở lại hồ sơ
 * thì mặc định về "Đang dùng" (Q-15) — vẫn chọn được Dự phòng/Hỏng trước khi xác nhận.
 */
export function StatusDialog({
  code,
  current,
  reopen,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  code: string;
  current: DeviceStatus;
  /** Hồ sơ đang thanh lý — hộp mở lại hồ sơ. */
  reopen: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (status: DeviceStatus) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<DeviceStatus>(
    reopen ? 'in_use' : current === 'in_use' ? 'spare' : 'in_use',
  );
  const action = reopen ? t('devices.reopen') : t('devices.changeStatus');
  return (
    <Dialog
      open
      onOpenChange={busy ? () => undefined : onCancel}
      dismissible={!busy}
      maxWidth={480}
      title={t('common.titleOf', { action, subject: code })}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || (!reopen && target === current)}
            onClick={() => onConfirm(target)}
          >
            {action}
          </button>
        </>
      }
    >
      {reopen ? <p>{t('devices.confirmReopen', { name: code })}</p> : null}
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}
      <Field label={t('devices.newStatus')}>
        <Select
          value={target}
          ariaLabel={t('devices.newStatus')}
          options={TARGETS.map((status) => ({
            value: status,
            label:
              !reopen && status === current
                ? t('devices.statusCurrent', { status: t(STATUS_KEY[status]) })
                : t(STATUS_KEY[status]),
          }))}
          onChange={(value) => setTarget(value as DeviceStatus)}
        />
      </Field>
    </Dialog>
  );
}
