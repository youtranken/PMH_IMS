import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { DeviceRow } from '@/lib/device-types';
import { RowActions, type RowAction } from '@/ui/row-actions';

/**
 * Các việc trong menu ⋮ của MỘT thiết bị — dùng chung cho cột Thao tác của danh sách và đầu
 * trang chi tiết, để hai chỗ không bày hai bộ việc khác nhau cho cùng một cái máy (Q-18).
 *
 * `onEdit` chỉ truyền khi nút Sửa KHÔNG đứng ngoài (trang chi tiết trên điện thoại); nút Sửa đã
 * ở ngoài mà còn trong menu là hai lối cho một việc. `onReopen` vắng thì máy đã thanh lý không
 * có "Đưa lại vào dùng" trong menu — nơi gọi đã để nó thành nút chính bên ngoài.
 */
export function deviceMenuItems(
  t: TFunction,
  retired: boolean,
  handlers: {
    onEdit?: () => void;
    onStatus: () => void;
    onClone: () => void;
    onRetire: () => void;
    onReopen?: () => void;
  },
): RowAction[] {
  if (retired) {
    return [
      ...(handlers.onReopen
        ? [{ key: 'reopen', label: t('devices.reopen'), onSelect: handlers.onReopen, ok: true }]
        : []),
      { key: 'clone', label: t('devices.clone'), onSelect: handlers.onClone },
    ];
  }
  return [
    ...(handlers.onEdit
      ? [{ key: 'edit', label: t('devices.edit'), onSelect: handlers.onEdit }]
      : []),
    { key: 'status', label: t('devices.changeStatus'), onSelect: handlers.onStatus },
    { key: 'clone', label: t('devices.clone'), onSelect: handlers.onClone },
    { key: 'retire', label: t('devices.retire'), onSelect: handlers.onRetire, danger: true },
  ];
}

/**
 * Ô Thao tác của một dòng thiết bị: "Sửa" đứng ngoài (việc hằng ngày), phần còn lại vào ⋮.
 *
 * Máy đã thanh lý thì API từ chối mọi lượt sửa (DEVICE_RETIRED): nút Sửa vẫn ĐỨNG ĐÓ (tắt) kèm
 * lý do đọc được, để hàng không lệch cột và người ta biết vì sao. Lối quay lại là "Đưa lại vào
 * dùng" trong menu.
 */
export function DeviceRowActions({
  device,
  onEdit,
  onStatus,
  onClone,
  onRetire,
}: {
  device: DeviceRow;
  onEdit: (device: DeviceRow) => void;
  /** Đổi trạng thái — và mở lại hồ sơ đã thanh lý (cùng một hộp). */
  onStatus: (device: DeviceRow) => void;
  onClone: (device: DeviceRow) => void;
  onRetire: (device: DeviceRow) => void;
}) {
  const { t } = useTranslation();
  const retired = device.status === 'retired';
  return (
    <RowActions
      primary={{
        label: t('common.edit'),
        ariaLabel: t('devices.editOf', { device: device.code }),
        onClick: () => onEdit(device),
        disabledReason: retired ? t('devices.retiredLockedShort') : null,
      }}
      label={t('common.actionsOf', { subject: device.code })}
      subject={device.code}
      items={deviceMenuItems(t, retired, {
        onStatus: () => onStatus(device),
        onReopen: () => onStatus(device),
        onClone: () => onClone(device),
        onRetire: () => onRetire(device),
      })}
    />
  );
}
