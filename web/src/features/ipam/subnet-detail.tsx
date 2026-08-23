import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Combobox } from '@/ui/combobox';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { DatePicker } from '@/ui/date-picker';
import { LoadError, Loading, NotFound } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { UsageBar } from '@/ui/usage-bar';
import { useToast } from '@/ui/toast';
import { STATUS_KEY, STATUS_TONE, type IpRow, type SubnetRow, type SubnetSlot } from './ipam-types';

interface DeviceOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Toàn bộ một dải: IP đã có hồ sơ và ô còn trống, xếp theo thứ tự địa chỉ (story 5.1).
 *
 * Ô trống hiện luôn trong bảng chứ không giấu sau một nút "thêm IP": câu hỏi thật khi cắm máy
 * là "còn chỗ nào trống", và nhìn thấy chỗ trống rồi bấm vào đó là đường ngắn nhất.
 */
export function SubnetDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [editing, setEditing] = useState<{ record: IpRow | null; address: string } | null>(null);

  const subnet = useQuery({
    queryKey: ['ipam', 'subnets', id],
    queryFn: () => apiFetch<SubnetRow>(`/api/v1/ipam/subnets/${id}`),
    retry: false,
  });

  const slots = useQuery({
    queryKey: ['ipam', 'subnets', id, 'addresses'],
    queryFn: () => apiFetch<SubnetSlot[]>(`/api/v1/ipam/subnets/${id}/addresses`),
    enabled: subnet.isSuccess,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });

  const rows = useMemo(
    () => (slots.data ?? []).filter((slot) => !onlyUsed || slot.kind === 'record'),
    [slots.data, onlyUsed],
  );

  if (subnet.isLoading) return <Loading />;
  if (subnet.isError) {
    return subnet.error instanceof ApiError && subnet.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError onRetry={() => void subnet.refetch()} />
    );
  }

  const item = subnet.data!;

  return (
    <>
      <PageHeader
        title={`${item.cidr} — ${item.name}`}
        subtitle={item.siteCode ? `${t('ipam.site')}: ${item.siteCode}` : undefined}
        actions={
          <Link className="btn" to="/dia-chi-ip">
            {t('ipam.back')}
          </Link>
        }
      />

      <div className="device-summary">
        <UsageBar
          percent={item.percent}
          ariaLabel={t('ipam.usageOf', { cidr: item.cidr })}
          label={t('ipam.usageLabel', { used: item.used, total: item.total, free: item.free })}
        />
        <label className="row" style={{ gap: 'var(--space-2)' }}>
          <input
            type="checkbox"
            checked={onlyUsed}
            onChange={(e) => setOnlyUsed(e.target.checked)}
          />
          <span className="muted">{t('ipam.onlyUsed')}</span>
        </label>
      </div>

      {slots.isLoading ? (
        <Loading />
      ) : slots.isError ? (
        <LoadError onRetry={() => void slots.refetch()} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('ipam.address')}</th>
                <th>{t('ipam.status')}</th>
                <th>{t('ipam.device')}</th>
                <th>{t('ipam.usedBy')}</th>
                <th>{t('ipam.assignedAt')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((slot) =>
                slot.kind === 'free' ? (
                  <tr key={slot.address} className="row-muted">
                    <td data-label={t('ipam.address')}>
                      <span className="mono">{slot.address}</span>
                    </td>
                    <td data-label={t('ipam.status')}>
                      <span className="badge muted">{t('ipam.statusFree')}</span>
                    </td>
                    <td data-label={t('ipam.device')}>—</td>
                    <td data-label={t('ipam.usedBy')}>—</td>
                    <td data-label={t('ipam.assignedAt')}>—</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setEditing({ record: null, address: slot.address })}
                      >
                        {t('ipam.assign')}
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={slot.id}>
                    <td data-label={t('ipam.address')}>
                      <span className="mono">{slot.address}</span>
                    </td>
                    <td data-label={t('ipam.status')}>
                      <span className={`badge ${STATUS_TONE[slot.status]}`}>
                        {t(STATUS_KEY[slot.status])}
                      </span>
                    </td>
                    <td data-label={t('ipam.device')}>
                      {slot.deviceId ? (
                        <Link to={`/thiet-bi/${slot.deviceId}`}>{slot.deviceCode}</Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label={t('ipam.usedBy')}>{orDash(slot.usedBy)}</td>
                    <td data-label={t('ipam.assignedAt')}>
                      {orDash(formatDate(slot.assignedAt))}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setEditing({ record: slot, address: slot.address })}
                      >
                        {t('common.edit')}
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <IpForm
          subnetId={id}
          record={editing.record}
          address={editing.address}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t('ipam.ipSaved') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function IpForm({
  subnetId,
  record,
  address,
  csrfToken,
  onClose,
  onSaved,
}: {
  subnetId: string;
  record: IpRow | null;
  address: string;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState(record?.deviceId ?? '');
  const [deviceTerm, setDeviceTerm] = useState(record?.deviceCode ?? '');
  const [usedBy, setUsedBy] = useState(record?.usedBy ?? '');
  const [assignedAt, setAssignedAt] = useState(record?.assignedAt ?? '');
  const [note, setNote] = useState(record?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ['devices', 'search', deviceTerm],
    queryFn: () =>
      apiFetch<{ items: DeviceOption[] }>(
        `/api/v1/devices?limit=20&search=${encodeURIComponent(deviceTerm)}`,
      ),
    enabled: deviceTerm.length > 0,
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    record ? `/api/v1/ipam/addresses/${record.id}` : '/api/v1/ipam/addresses',
    { method: record ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <Dialog open onOpenChange={onClose} maxWidth={560}>
      <DialogTitle>{record ? t('ipam.editIp', { address }) : t('ipam.assignIp', { address })}</DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate(
            record
              ? { deviceId, usedBy: usedBy.trim(), assignedAt, note: note.trim() }
              : {
                  subnetId,
                  address,
                  deviceId,
                  usedBy: usedBy.trim(),
                  assignedAt,
                  note: note.trim(),
                },
            { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <Field label={t('ipam.address')}>
          <p className="mono">{address}</p>
        </Field>

        <Field label={t('ipam.device')} hint={t('ipam.deviceHint')}>
          <Combobox
            placeholder={t('ipam.deviceSearch')}
            query={deviceTerm}
            onQuery={(value) => {
              setDeviceTerm(value);
              // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện mã A mà id gửi đi là B.
              setDeviceId('');
            }}
            options={devices.data?.items ?? []}
            getKey={(item) => item.id}
            renderOption={(item) => (
              <>
                <span className="mono">{item.code}</span> <small>{item.name}</small>
              </>
            )}
            onSelect={(item) => {
              setDeviceId(item.id);
              setDeviceTerm(item.code);
            }}
          />
        </Field>

        <Field label={t('ipam.usedBy')} hint={t('ipam.usedByHint')} htmlFor="ip-used-by">
          <input
            id="ip-used-by"
            className="inp"
            value={usedBy}
            onChange={(e) => setUsedBy(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.assignedAt')}>
          <DatePicker value={assignedAt} onChange={setAssignedAt} ariaLabel={t('ipam.assignedAt')} />
        </Field>

        <Field label={t('ipam.note')} htmlFor="ip-note">
          <textarea
            id="ip-note"
            className="inp"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
