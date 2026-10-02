import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useFormErrors } from '@/ui/use-form-errors';
import { PATHS } from '@/lib/routes';
import { AssignIpDialog } from './ip-assign-dialog';
import type { IpRow, SubnetRow, SubnetSlot } from './ipam-types';
import { nextFreeSlot, slotStatus } from './slot-paging';

/**
 * "Cấp IP" từ TRANG THIẾT BỊ (DEV-089): chọn dải → chọn IP trống (điền sẵn ô trống đầu tiên,
 * bỏ gateway) → hộp Cấp IP dùng chung của dải, với máy đang xem đã điền sẵn.
 *
 * Không có lối này thì phải sang màn Địa chỉ IP, chọn dải, lật trang tìm ô trống rồi gõ lại mã
 * máy. Bước hai là CHÍNH hộp `AssignIpDialog` của màn dải — một luật cấp IP, không phải hai.
 *
 * `change`: máy đã có IP (Q-20 — một máy một IP) thì đây là "Đổi IP": cùng hai bước, nhưng bước
 * hai gửi MỘT lượt đổi (thu hồi IP cũ + cấp IP mới trong một transaction).
 */
export function DeviceIpAssign({
  device,
  change = false,
  csrfToken,
  onClose,
  onDone,
}: {
  device: { id: string; code: string };
  change?: boolean;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [subnetId, setSubnetId] = useState('');
  const [picked, setPicked] = useState('');
  const [chosen, setChosen] = useState<{ address: string; record: IpRow | null } | null>(null);

  // Chỉ dải đang dùng: dải đã vô hiệu hoá không cấp được gì.
  const subnets = useQuery({
    queryKey: ['ipam', 'subnets', 'active'],
    queryFn: () => apiFetch<SubnetRow[]>('/api/v1/ipam/subnets'),
  });
  const subnet = subnets.data?.find((row) => row.id === subnetId) ?? null;
  const held = useQuery({
    queryKey: ['ipam', 'devices', device.id, 'addresses'],
    queryFn: () => apiFetch<IpRow[]>(`/api/v1/ipam/devices/${device.id}/addresses`),
    enabled: change,
  });
  const current = held.data?.find((row) => row.status === 'assigned') ?? null;
  const slots = useQuery({
    queryKey: ['ipam', 'subnets', subnetId, 'addresses', false],
    queryFn: () => apiFetch<SubnetSlot[]>(`/api/v1/ipam/subnets/${subnetId}/addresses`),
    enabled: !!subnetId,
  });
  const free = useMemo(
    () =>
      (slots.data ?? []).filter(
        (slot) => slotStatus(slot) === 'free' && slot.address !== subnet?.gateway,
      ),
    [slots.data, subnet?.gateway],
  );
  const suggested = useMemo(
    () => nextFreeSlot(slots.data ?? [], subnet?.gateway ?? null),
    [slots.data, subnet?.gateway],
  );
  const address = picked || suggested?.address || '';

  const check = useFormErrors({
    subnet: !subnetId && t('ipam.pickSubnetRequired'),
    address: !!subnetId && slots.isSuccess && !address && t('ipam.noFreeInSubnet'),
  });

  /* Chưa khai dải nào thì ô chọn dải chỉ là một menu trống và nút "Tiếp tục" chỉ dẫn tới lỗi.
     Nói thẳng lý do và đưa lối sang màn Địa chỉ IP, nơi khai dải. */
  const noSubnet = subnets.isSuccess && subnets.data.length === 0;

  if (chosen && subnet) {
    return (
      <AssignIpDialog
        subnetId={subnet.id}
        address={chosen.address}
        record={chosen.record}
        network={{ cidr: subnet.cidr, gateway: subnet.gateway, vlan: subnet.vlan }}
        initialDevice={{ deviceId: device.id, term: device.code }}
        replacing={
          current
            ? { id: current.id, address: current.address, usedBy: current.usedBy, note: current.note }
            : undefined
        }
        csrfToken={csrfToken}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={onClose}
      initialFocus="first-field"
      maxWidth={520}
      title={t(change ? 'ipam.changeForDevice' : 'ipam.assignForDevice', { code: device.code })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {noSubnet ? null : (
            <button type="submit" form="device-ip-pick" className="btn primary">
              {t('ipam.pickNext')}
            </button>
          )}
        </>
      }
    >
      {noSubnet ? (
        <EmptyState
          title={t('ipam.noSubnetToAssign')}
          hint={t('ipam.noSubnetToAssignHint')}
          action={
            <Link className="linkbtn primary" to={PATHS.ipAddresses} onClick={onClose}>
              {t('ipam.goAddSubnet')}
            </Link>
          }
        />
      ) : (
        <form
          id="device-ip-pick"
          className="form-grid"
          data-columns={1}
          ref={check.formRef}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            // Đổi IP mà chưa đọc được IP đang giữ thì chưa đi tiếp: gửi lượt cấp thường sẽ bị
            // API từ chối (một máy một IP) với câu khó hiểu hơn.
            if (!check.check() || !address || (change && !current)) return;
            const slot = free.find((row) => row.address === address);
            setChosen({ address, record: slot?.kind === 'record' ? slot : null });
          }}
        >
          {change ? (
            <Field label={t('ipam.currentIp')} hint={t('ipam.changeHint')}>
              <p className="static-value mono">{current?.address ?? '—'}</p>
            </Field>
          ) : null}
          <Field label={t('ipam.pickSubnetLabel')} required error={check.error('subnet')}>
            <Select
              value={subnetId}
              ariaLabel={t('ipam.pickSubnetLabel')}
              placeholder={t('ipam.pickSubnetPlaceholder')}
              options={(subnets.data ?? []).map((row) => ({
                value: row.id,
                label: `${row.name} · ${t('ipam.subnetOption', {
                  cidr: row.cidr,
                  vlan: row.vlan === null ? '' : ` · ${t('ipam.vlanBadge', { vlan: row.vlan })}`,
                  free: row.free,
                })}`,
                searchText: `${row.name} ${row.cidr} ${row.vlan ?? ''}`,
              }))}
              failed={subnets.isError}
              onChange={(value) => {
                setSubnetId(value);
                setPicked('');
              }}
            />
          </Field>

          {subnetId ? (
            slots.isError ? (
              <LoadError error={slots.error} onRetry={() => void slots.refetch()} />
            ) : (
              <Field
                label={t('ipam.pickAddress')}
                hint={subnet ? t('ipam.pickAddressHint', { count: free.length }) : undefined}
                error={check.error('address')}
              >
                <Select
                  value={address}
                  ariaLabel={t('ipam.pickAddress')}
                  placeholder={slots.isLoading ? t('common.loading') : t('ipam.noFreeInSubnet')}
                  options={free.map((slot) => ({ value: slot.address, label: slot.address }))}
                  disabled={slots.isLoading || free.length === 0}
                  onChange={setPicked}
                />
              </Field>
            )
          ) : null}
        </form>
      )}
    </Dialog>
  );
}
