import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { Dialog } from '@/ui/dialog';
import { LoadError } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useFormErrors } from '@/ui/use-form-errors';
import { AssignIpDialog } from './ip-assign-dialog';
import type { IpRow, SubnetRow, SubnetSlot } from './ipam-types';
import { nextFreeSlot, slotStatus } from './slot-paging';

/**
 * "Cấp IP" từ TRANG THIẾT BỊ (DEV-089): chọn dải → chọn IP trống (điền sẵn ô trống đầu tiên,
 * bỏ gateway) → hộp Cấp IP dùng chung của dải, với máy đang xem đã điền sẵn.
 *
 * Không có lối này thì phải sang màn Địa chỉ IP, chọn dải, lật trang tìm ô trống rồi gõ lại mã
 * máy. Bước hai là CHÍNH hộp `AssignIpDialog` của màn dải — một luật cấp IP, không phải hai.
 */
export function DeviceIpAssign({
  device,
  csrfToken,
  onClose,
  onDone,
}: {
  device: { id: string; code: string };
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

  if (chosen && subnet) {
    return (
      <AssignIpDialog
        subnetId={subnet.id}
        address={chosen.address}
        record={chosen.record}
        network={{ cidr: subnet.cidr, gateway: subnet.gateway, vlan: subnet.vlan }}
        initialDevice={{ deviceId: device.id, term: device.code }}
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
      title={t('ipam.assignForDevice', { code: device.code })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="device-ip-pick" className="btn primary">
            {t('ipam.pickNext')}
          </button>
        </>
      }
    >
      <form
        id="device-ip-pick"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!check.check() || !address) return;
          const slot = free.find((row) => row.address === address);
          setChosen({ address, record: slot?.kind === 'record' ? slot : null });
        }}
      >
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
    </Dialog>
  );
}
