import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { maskOfCidr } from '@/lib/ipv4';
import { CopyButton } from '@/ui/copy-button';
import { DataItemIfSet } from '@/ui/detail-header';
import { Combobox } from '@/ui/combobox';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { SuggestInput } from '@/ui/suggest-input';
import { useDepartments } from '@/ui/use-departments';
import { useFormErrors } from '@/ui/use-form-errors';
import type { IpRow } from './ipam-types';

export interface DeviceOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Q-14: hồ sơ IP phải gắn thiết bị hoặc người/bộ phận — cùng luật `IP_OWNER_REQUIRED` của API,
 * kiểm trước ở đây để lỗi hiện ngay dưới ô thay vì một dòng đỏ chung chung sau lượt gửi.
 */
export function ownerRule(t: TFunction, deviceId: string, usedBy: string): string | null {
  return deviceId || usedBy.trim() ? null : t('ipam.ownerRequired');
}

/** Ô chọn thiết bị cho hồ sơ IP — hộp Cấp và hộp Sửa hỏi cùng một câu, cùng một cách. */
export function DeviceCombobox({
  deviceId,
  term,
  onChange,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  deviceId: string;
  term: string;
  onChange: (next: { deviceId: string; term: string }) => void;
  /** Ba thuộc tính `Field` tự gắn vào đứa con — chuyển thẳng xuống ô gõ thật. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const { t } = useTranslation();
  const devices = useQuery({
    queryKey: ['devices', 'search', term],
    queryFn: () =>
      apiFetch<{ items: DeviceOption[] }>(
        `/api/v1/devices?limit=20&usable=true&search=${encodeURIComponent(term)}`,
      ),
    /*
     * Chưa gõ gì vẫn hỏi (20 máy đầu): mở ô ra mà trắng trơn thì người dùng không biết đây là
     * ô tìm hay ô chọn — cùng cách ô Router của form NAT. Đã chọn xong thì ô đang hiện đúng
     * mã máy, hỏi lại API cho chính cái mã đó là thừa.
     */
    enabled: !deviceId,
  });
  return (
    <Combobox
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      ariaLabel={t('ipam.device')}
      placeholder={t('ipam.deviceSearch')}
      query={term}
      // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện mã A mà id gửi đi là B.
      onQuery={(value) => onChange({ deviceId: '', term: value })}
      options={devices.data?.items ?? []}
      failed={devices.isError}
      getKey={(item) => item.id}
      renderOption={(item) => (
        <>
          <span className="mono">{item.code}</span> <small>{item.name}</small>
        </>
      )}
      onSelect={(item) => onChange({ deviceId: item.id, term: item.code })}
    />
  );
}

/** Mask · Gateway · VLAN của dải, mỗi dòng một nút chép — thứ cần gõ vào card mạng. */
function NetworkConfig({
  network,
}: {
  network: { cidr: string; gateway: string | null; vlan: number | null };
}) {
  const { t } = useTranslation();
  const mask = maskOfCidr(network.cidr);
  const rows: [string, string | null][] = [
    [t('ipam.mask'), mask],
    [t('ipam.gateway'), network.gateway],
    [t('ipam.vlan'), network.vlan === null ? null : String(network.vlan)],
  ];
  return (
    <div className="span-2 net-config">
      <p className="form-section-title">{t('ipam.netConfig')}</p>
      <dl className="data-grid">
        {rows.map(([label, value]) => (
          <DataItemIfSet key={label} label={label} value={value}>
            <span className="mono">{value}</span>{' '}
            <CopyButton value={value ?? ''} label={t('ipam.copyOf', { label })} />
          </DataItemIfSet>
        ))}
      </dl>
    </div>
  );
}

/**
 * MỘT hộp "Cấp IP" cho cả ô trống (chưa có hồ sơ) lẫn hồ sơ đang Trống (đã thu hồi).
 *
 * Hai trường hợp khác nhau ở DB nhưng giống hệt với người dùng: "chỗ này trống, cấp cho máy
 * kia". Hai hộp khác nhau cho cùng một việc từng làm hồ sơ đã thu hồi không gắn được máy. API
 * chọn đường phía sau: ô trống thì `POST addresses`, hồ sơ Trống thì `transition` — để lịch sử
 * "IP này từng của ai" nối tiếp thay vì mở một hồ sơ mới.
 */
export function AssignIpDialog({
  subnetId,
  address,
  record,
  network,
  initialDevice,
  csrfToken,
  onClose,
  onDone,
}: {
  subnetId: string;
  address: string;
  /** Hồ sơ đang Trống cần cấp lại; `null` = ô chưa từng có hồ sơ. */
  record: IpRow | null;
  /**
   * Cấu hình mạng của dải — người cắm máy phải gõ mask/gateway/VLAN vào card mạng ngay sau khi
   * cấp, nên hộp bày sẵn kèm nút chép thay vì bắt quay ra thẻ dải tra.
   */
  network?: { cidr: string; gateway: string | null; vlan: number | null };
  /** Máy điền sẵn — mở từ trang thiết bị thì máy đã biết, không bắt gõ lại mã. */
  initialDevice?: { deviceId: string; term: string };
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [device, setDevice] = useState(initialDevice ?? { deviceId: '', term: '' });
  // Hồ sơ Trống đã bị gỡ chủ lúc thu hồi, nên ô người dùng mở ra trống — điền lại tên chủ cũ
  // là hồi sinh một chủ không còn.
  const [usedBy, setUsedBy] = useState('');
  const [assignedAt, setAssignedAt] = useState(todayIso());
  const [note, setNote] = useState(record?.note ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const departments = useDepartments();
  const check = useFormErrors({ owner: ownerRule(t, device.deviceId, usedBy) });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    record ? `/api/v1/ipam/addresses/${record.id}/transition` : '/api/v1/ipam/addresses',
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      initialFocus="first-field"
      maxWidth={560}
      title={t('ipam.assignIp', { address })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="ip-assign-form"
            className="btn primary"
            disabled={save.isPending}
          >
            {save.isPending ? t('common.loading') : t('ipam.trAssign')}
          </button>
        </>
      }
    >
      <form
        id="ip-assign-form"
        className="form-grid"
        data-columns={2}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          const owner = {
            deviceId: device.deviceId,
            usedBy: usedBy.trim(),
            assignedAt,
            note: note.trim(),
            reason: reason.trim(),
          };
          save.mutate(
            record ? { to: 'assigned', ...owner } : { subnetId, address, ...owner },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <Field label={t('ipam.address')}>
          <p className="static-value mono">{address}</p>
        </Field>

        <Field label={t('ipam.device')} hint={t('ipam.deviceHint')} error={check.error('owner')}>
          <DeviceCombobox
            deviceId={device.deviceId}
            term={device.term}
            onChange={setDevice}
          />
        </Field>

        {network ? <NetworkConfig network={network} /> : null}

        <Field label={t('ipam.usedBy')} hint={t('ipam.usedByHint')}>
          <SuggestInput
            value={usedBy}
            onChange={setUsedBy}
            options={departments.names}
            failed={departments.failed}
            placeholder={t('ipam.usedByPlaceholder')}
            ariaLabel={t('ipam.usedBy')}
          />
        </Field>

        <Field label={t('ipam.assignedAt')}>
          <DatePicker value={assignedAt} onChange={setAssignedAt} ariaLabel={t('ipam.assignedAt')} />
        </Field>

        <Field label={t('ipam.note')} htmlFor="ip-assign-note" span={2}>
          <textarea
            id="ip-assign-note"
            className="inp"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.reason')} hint={t('ipam.reasonHint')} htmlFor="ip-assign-reason" span={2}>
          <input
            id="ip-assign-reason"
            className="inp"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
