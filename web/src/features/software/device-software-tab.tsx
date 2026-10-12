import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { Combobox } from '@/ui/combobox';
import { DetailSection } from '@/ui/detail-layout';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { useToast } from '@/ui/toast';
import { useDebouncedValue } from '@/ui/use-debounced-value';
import { AssignDialog } from './assign-dialog';
import { DeviceLicensesExpand } from './device-licenses-expand';
import { seatLabel, type SoftwareRow } from './software-types';

/**
 * Tab Phần mềm của trang thiết bị (Q-27): license đang cài (cùng bảng thẻ với khu bung dòng ở
 * danh sách) + "Gán phần mềm vào máy này".
 *
 * Gán đi ĐÚNG hộp Gán của phần mềm, máy này nằm sẵn trong lô (AD-15): ghế, vượt ghế, ghế riêng
 * đều do hộp đó lo — chép một hộp gán thứ hai ở đây là hai nơi trả lời khác nhau về một ghế.
 */
export function DeviceSoftwareTab({
  device,
  csrfToken,
  canEdit,
}: {
  device: { id: string; code: string };
  csrfToken: string;
  /** `false` khi máy đã thanh lý hoặc người xem không ghi được. */
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [software, setSoftware] = useState<SoftwareRow | null>(null);

  return (
    <DetailSection
      title={t('devices.softwareTabTitle')}
      compact
      action={
        canEdit ? (
          <button type="button" className="btn primary sm" onClick={() => setPicking(true)}>
            {t('devices.assignSoftware')}
          </button>
        ) : null
      }
    >
      <DeviceLicensesExpand deviceId={device.id} />

      {picking ? (
        <SoftwarePickDialog
          deviceCode={device.code}
          onClose={() => setPicking(false)}
          onPick={(row) => {
            setPicking(false);
            setSoftware(row);
          }}
        />
      ) : null}
      {software ? (
        <AssignDialog
          software={software}
          initialDevices={[device]}
          csrfToken={csrfToken}
          onClose={() => setSoftware(null)}
          onDone={(warnings, count) => {
            setSoftware(null);
            toast({ message: t('license.assignedCount', { count }) });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void queryClient.invalidateQueries({ queryKey: ['software'] });
            void queryClient.invalidateQueries({ queryKey: ['devices'] });
          }}
        />
      ) : null}
    </DetailSection>
  );
}

/** Bước 1: chọn license còn dùng. Chọn xong là sang hộp Gán, không có nút "Tiếp". */
function SoftwarePickDialog({
  deviceCode,
  onClose,
  onPick,
}: {
  deviceCode: string;
  onClose: () => void;
  onPick: (row: SoftwareRow) => void;
}) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term);
  const params = new URLSearchParams({ kind: 'license', status: 'active', limit: '20' });
  if (search.trim()) params.set('search', search.trim());
  const list = useQuery({
    queryKey: ['software', 'pick-license', params.toString()],
    queryFn: () => apiFetch<{ items: SoftwareRow[] }>(`/api/v1/software?${params.toString()}`),
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())} title={t('devices.assignSoftwareTitle', { code: deviceCode })} maxWidth={560}>
      <Field label={t('devices.pickLicense')} hint={t('devices.pickLicenseHint')}>
        <Combobox<SoftwareRow>
          ariaLabel={t('devices.pickLicense')}
          placeholder={t('devices.pickLicensePlaceholder')}
          query={term}
          onQuery={setTerm}
          options={list.data?.items ?? []}
          pending={list.isFetching}
          failed={list.isError}
          getKey={(row) => row.id}
          renderOption={(row) => (
            <>
              <span className="mono">{row.code}</span> <small>{row.name} · {t('devices.pickLicenseSeats', { seats: seatLabel(row) })}</small>
            </>
          )}
          onSelect={onPick}
        />
      </Field>
    </Dialog>
  );
}
