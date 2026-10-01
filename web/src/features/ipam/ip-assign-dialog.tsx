import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { todayIso } from '@/lib/format';
import { maskOfCidr } from '@/lib/ipv4';
import { CopyButton } from '@/ui/copy-button';
import { DataItemIfSet } from '@/ui/detail-header';
import { DeviceCombobox } from '@/ui/device-combobox';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useDepartments } from '@/ui/use-departments';
import { secretTextRule, useFormErrors, useSubmitError } from '@/ui/use-form-errors';
import type { IpRow } from './ipam-types';

/**
 * Q-14: hồ sơ IP phải gắn thiết bị hoặc người/bộ phận — cùng luật `IP_OWNER_REQUIRED` của API,
 * kiểm trước ở đây để lỗi hiện ngay dưới ô thay vì một dòng đỏ chung chung sau lượt gửi.
 */
export function ownerRule(t: TFunction, deviceId: string, usedBy: string): string | null {
  return deviceId || usedBy.trim() ? null : t('ipam.ownerRequired');
}

/**
 * Ô chọn thiết bị cho hồ sơ IP — hộp Cấp và hộp Sửa hỏi cùng một câu, cùng một cách. Ghi ngay
 * cạnh mã máy nào ĐÃ giữ IP để khỏi cấp hai địa chỉ cho một máy (Q-20).
 */
export function IpDeviceCombobox({
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
  return (
    <DeviceCombobox
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      ariaLabel={t('ipam.device')}
      placeholder={t('ipam.deviceSearch')}
      value={{ deviceId, term }}
      onChange={(next) => onChange({ deviceId: next.deviceId, term: next.term })}
      annotate={(ids) => ({
        queryKey: ['ipam', 'devices', 'addresses', ids],
        queryFn: async () => {
          const held = await apiFetch<Record<string, string[]>>(
            `/api/v1/ipam/devices/addresses?deviceIds=${ids.join(',')}`,
          );
          return Object.fromEntries(
            Object.entries(held)
              .filter(([, ips]) => ips.length > 0)
              .map(([deviceKey, ips]) => [deviceKey, t('ipam.deviceHasIp', { ip: ips.join(', ') })]),
          );
        },
      })}
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
            <CopyButton value={value ?? ''} label={t('ipam.copyOf', { label })} inline />
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
  address: initialAddress,
  record: initialRecord,
  network,
  initialDevice,
  replacing,
  choices,
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
  /**
   * Đổi IP (Q-20): IP máy đang giữ. Có thì hộp gửi MỘT lượt `change` — API thu hồi IP này và
   * cấp địa chỉ mới trong cùng transaction — và máy không đổi được trong hộp. Người/bộ phận
   * và ghi chú đi theo máy nên điền sẵn từ IP cũ.
   */
  replacing?: { id: string; address: string; usedBy?: string | null; note?: string | null };
  /**
   * Các chỗ trống của dải để đổi địa chỉ ngay trong hộp ("Cấp IP trống kế tiếp" điền sẵn chỗ
   * nhỏ nhất, người cắm máy có thể muốn chỗ khác). Không truyền thì địa chỉ cố định.
   */
  choices?: { address: string; record: IpRow | null }[];
  csrfToken: string;
  onClose: () => void;
  /** Nhận địa chỉ THẬT đã cấp — có thể khác `address` khi người dùng đổi trong hộp. */
  onDone: (address: string) => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState({ address: initialAddress, record: initialRecord });
  const { address, record } = target;
  const [device, setDevice] = useState(initialDevice ?? { deviceId: '', term: '' });
  // Hồ sơ Trống đã bị gỡ chủ lúc thu hồi, nên ô người dùng mở ra trống — điền lại tên chủ cũ
  // là hồi sinh một chủ không còn. Đổi IP thì khác: chủ vẫn là máy đó, người dùng máy không đổi.
  const [usedBy, setUsedBy] = useState(replacing?.usedBy ?? '');
  const [assignedAt, setAssignedAt] = useState(todayIso());
  const [note, setNote] = useState(
    replacing ? (replacing.note ?? '') : (initialRecord?.note ?? ''),
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useSubmitError([target, device, usedBy, assignedAt, note, reason]);
  const departments = useDepartments();
  const check = useFormErrors({
    owner: ownerRule(t, device.deviceId, usedBy),
    note: secretTextRule(t, note),
    reason: secretTextRule(t, reason),
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    replacing
      ? `/api/v1/ipam/addresses/${replacing.id}/change`
      : record
        ? `/api/v1/ipam/addresses/${record.id}/transition`
        : '/api/v1/ipam/addresses',
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
      title={t(replacing ? 'ipam.changeIp' : 'ipam.assignIp', { address })}
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
            {save.isPending ? t('common.working') : t(replacing ? 'ipam.trChange' : 'ipam.trAssign')}
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
            replacing
              ? {
                  subnetId,
                  address,
                  usedBy: owner.usedBy,
                  assignedAt,
                  note: owner.note,
                  reason: owner.reason,
                }
              : record
                ? { to: 'assigned', ...owner }
                : { subnetId, address, ...owner },
            { onSuccess: () => onDone(address), onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        {choices && choices.length > 1 ? (
          <Field label={t('ipam.address')}>
            <Select
              value={address}
              ariaLabel={t('ipam.address')}
              options={choices.map((choice) => ({
                value: choice.address,
                label: choice.record ? (
                  <>
                    <span className="mono">{choice.address}</span>{' '}
                    <small className="muted">{t('ipam.choiceFreedRecord')}</small>
                  </>
                ) : (
                  <span className="mono">{choice.address}</span>
                ),
                searchText: choice.address,
              }))}
              onChange={(value) => {
                const next = choices.find((choice) => choice.address === value);
                if (next) setTarget(next);
              }}
            />
          </Field>
        ) : (
          <Field label={t('ipam.address')}>
            <p className="static-value mono">{address}</p>
          </Field>
        )}

        {replacing ? (
          <Field label={t('ipam.device')} hint={t('ipam.changeHint')}>
            <p className="static-value">
              <span className="mono">{device.term}</span>
              {' · '}
              {t('ipam.currentIp')} <span className="mono">{replacing.address}</span>
            </p>
          </Field>
        ) : (
          <Field label={t('ipam.device')} hint={t('ipam.deviceHint')} error={check.error('owner')}>
            <IpDeviceCombobox
              deviceId={device.deviceId}
              term={device.term}
              onChange={setDevice}
            />
          </Field>
        )}

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

        <Field label={t('ipam.note')} hint={t('ipam.noteHint')} htmlFor="ip-assign-note" span={2} error={check.error('note')}>
          <textarea
            id="ip-assign-note"
            className="inp"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        <Field
          label={t('ipam.reason')}
          hint={t('ipam.reasonHint')}
          htmlFor="ip-assign-reason"
          span={2}
          error={check.error('reason')}
        >
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
