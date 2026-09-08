import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import { Combobox } from '@/ui/combobox';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { RowActions } from '@/ui/row-actions';
import { SuggestInput } from '@/ui/suggest-input';
import { useDepartments } from '@/ui/use-departments';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import type { DeviceRow } from '@/lib/device-types';
import { PATHS } from '@/lib/routes';

export interface PortRow {
  id: string;
  portLabel: string;
  connectedDeviceId: string | null;
  connectedDeviceCode: string | null;
  connectedDeviceName: string | null;
  connectedLabel: string | null;
  connectedPort: string | null;
  usedBy: string | null;
  /** VLAN của cổng (0029) — text vì "trunk" là giá trị có thật trên uplink. */
  vlan: string | null;
  note: string | null;
}

export interface IncomingPortRow {
  id: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  portLabel: string;
  connectedPort: string | null;
  usedBy: string | null;
  note: string | null;
}

interface PortMap {
  ports: PortRow[];
  incoming: IncomingPortRow[];
}

/**
 * Port map của một thiết bị (story 2.4, FR-006, AD-14).
 *
 * Bảng dưới ("Đang cắm vào thiết bị này") KHÔNG phải dữ liệu riêng — nó là CHIỀU NGƯỢC
 * của những dòng do thiết bị khác giữ, dựng bằng query. Không sửa được ở đây là có chủ ý:
 * sửa ở đúng nơi giữ bản ghi thì hai đầu không bao giờ mâu thuẫn nhau.
 */
export function PortMapPanel({
  device,
  csrfToken,
  canEdit,
}: {
  device: DeviceRow;
  csrfToken: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ port: PortRow | null } | null>(null);

  const queryKey = ['devices', device.id, 'ports'];
  const map = useQuery({
    queryKey,
    queryFn: () => apiFetch<PortMap>(`/api/v1/devices/${device.id}/ports`),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/devices/${device.id}/ports/${input.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const ports = map.data?.ports ?? [];
  const incoming = map.data?.incoming ?? [];

  return (
    <div className="port-map">
      {canEdit ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn primary" onClick={() => setEditing({ port: null })}>
            {t('ports.add')}
          </button>
        </div>
      ) : null}

      {map.isLoading ? (
        <Loading />
      ) : map.isError ? (
        <LoadError onRetry={() => void map.refetch()} />
      ) : (
        <>
          <h3 className="form-section-title">{t('ports.own')}</h3>
          {ports.length === 0 ? (
            <EmptyState title={t('ports.empty')} hint={t('ports.emptyHint')} />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>{t('ports.port')}</th>
                    <th>{t('ports.connectedTo')}</th>
                    <th>{t('ports.peerPort')}</th>
                    <th>{t('ports.usedBy')}</th>
                    <th>{t('ports.vlan')}</th>
                    <th>{t('ports.note')}</th>
                    {canEdit ? <th className="col-center">{t('common.actions')}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {ports.map((port) => (
                    <tr key={port.id}>
                      <td data-label={t('ports.port')} className="mono">
                        {port.portLabel}
                      </td>
                      <td data-label={t('ports.connectedTo')}>
                        {port.connectedDeviceId ? (
                          <Link className="mono" to={PATHS.device(port.connectedDeviceId)}>
                            {port.connectedDeviceCode}
                          </Link>
                        ) : (
                          orDash(port.connectedLabel)
                        )}
                        {port.connectedDeviceName ? (
                          <span className="cell-sub">{port.connectedDeviceName}</span>
                        ) : null}
                      </td>
                      <td data-label={t('ports.peerPort')} className="mono">
                        {orDash(port.connectedPort)}
                      </td>
                      <td data-label={t('ports.usedBy')}>{orDash(port.usedBy)}</td>
                      <td data-label={t('ports.vlan')} className="mono">
                        {orDash(port.vlan)}
                      </td>
                      <td data-label={t('ports.note')}>{orDash(port.note)}</td>
                      {canEdit ? (
                        <td>
                          <div className="action-cell">
                            <RowActions
                              label={t('common.actionsOf', { subject: port.portLabel })}
                              items={[
                                {
                                  key: 'edit',
                                  label: t('ports.edit'),
                                  onSelect: () => setEditing({ port }),
                                },
                                {
                                  key: 'remove',
                                  label: t('ports.remove'),
                                  danger: true,
                                  disabled: remove.isPending,
                                  onSelect: () => {
                                    void (async () => {
                                      const ok = await askConfirm({
                                        message: t('ports.confirmRemove', {
                                          port: port.portLabel,
                                        }),
                                        danger: true,
                                        confirmLabel: t('ports.remove'),
                                      });
                                      if (!ok) return;
                                      remove.mutate(
                                        { id: port.id },
                                        {
                                          onSuccess: () => {
                                            toast({ message: t('ports.removed') });
                                            void refresh();
                                          },
                                          onError: (error) =>
                                            toast({
                                              message: errorMessage(error),
                                              tone: 'error',
                                            }),
                                        },
                                      );
                                    })();
                                  },
                                },
                              ]}
                            />
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="form-section-title">{t('ports.incoming')}</h3>
          <p className="muted">{t('ports.incomingHint')}</p>
          {incoming.length === 0 ? (
            <p className="muted">{t('ports.incomingEmpty')}</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>{t('ports.fromDevice')}</th>
                    <th>{t('ports.port')}</th>
                    <th>{t('ports.peerPort')}</th>
                    <th>{t('ports.usedBy')}</th>
                    <th>{t('ports.note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {incoming.map((row) => (
                    <tr key={row.id}>
                      <td data-label={t('ports.fromDevice')}>
                        <Link className="mono" to={PATHS.device(row.deviceId)}>
                          {row.deviceCode}
                        </Link>
                        <span className="cell-sub">{row.deviceName}</span>
                      </td>
                      <td data-label={t('ports.port')} className="mono">
                        {row.portLabel}
                      </td>
                      <td data-label={t('ports.peerPort')} className="mono">
                        {orDash(row.connectedPort)}
                      </td>
                      <td data-label={t('ports.usedBy')}>{orDash(row.usedBy)}</td>
                      <td data-label={t('ports.note')}>{orDash(row.note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editing ? (
        <PortForm
          deviceId={device.id}
          port={editing.port}
          csrfToken={csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function PortForm({
  deviceId,
  port,
  csrfToken,
  onClose,
  onSaved,
}: {
  deviceId: string;
  port: PortRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [portLabel, setPortLabel] = useState(port?.portLabel ?? '');
  const [peer, setPeer] = useState<{ id: string; code: string } | null>(
    port?.connectedDeviceId
      ? { id: port.connectedDeviceId, code: port.connectedDeviceCode ?? '' }
      : null,
  );
  const [query, setQuery] = useState(port?.connectedDeviceCode ?? '');
  const [debounced, setDebounced] = useState(query);
  const [connectedLabel, setConnectedLabel] = useState(port?.connectedLabel ?? '');
  const [connectedPort, setConnectedPort] = useState(port?.connectedPort ?? '');
  const [usedBy, setUsedBy] = useState(port?.usedBy ?? '');
  const [vlan, setVlan] = useState(port?.vlan ?? '');
  const departments = useDepartments();
  const [note, setNote] = useState(port?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  // Gõ tới đâu tìm tới đó nhưng chờ 250ms — không bắn một request mỗi phím.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&search=${encodeURIComponent(debounced.trim())}`,
      ),
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    port
      ? `/api/v1/devices/${deviceId}/ports/${port.id}`
      : `/api/v1/devices/${deviceId}/ports`,
    { method: port ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={620}
      title={port ? t('ports.edit') : t('ports.add')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="port-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="port-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!portLabel.trim()) {
            setError(t('ports.portRequired'));
            return;
          }
          save.mutate(
            {
              portLabel: portLabel.trim(),
              connectedDeviceId: peer?.id ?? '',
              // Đã chọn thiết bị trong kho thì mô tả tự do là thừa — xóa để một sợi dây
              // chỉ có MỘT nguồn sự thật về đầu kia.
              connectedLabel: peer ? '' : connectedLabel.trim(),
              connectedPort: connectedPort.trim(),
              usedBy: usedBy.trim(),
              vlan: vlan.trim(),
              note: note.trim(),
            },
            {
              onSuccess: onSaved,
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <Field label={t('ports.port')} required htmlFor="port-label">
          <input
            id="port-label"
            className="inp mono"
            required
            value={portLabel}
            onChange={(e) => setPortLabel(e.target.value)}
          />
        </Field>

        <Field label={t('ports.peerDevice')} hint={t('ports.peerDeviceHint')}>
          <Combobox
            placeholder={t('ports.peerSearch')}
            /* Tên trợ năng tường minh: form này giờ có HAI combobox (thiết bị đầu kia và ô
               "ai dùng" gợi ý theo danh mục Bộ phận). Không đặt tên thì cả người dùng trình
               đọc màn hình lẫn bài kiểm đều không phân biệt được hai ô. */
            ariaLabel={t('ports.peerDevice')}
            query={query}
            onQuery={(value) => {
              setQuery(value);
              // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện tên A mà id vẫn là B.
              setPeer(null);
            }}
            options={candidates.data?.items.filter((item) => item.id !== deviceId) ?? []}
            failed={candidates.isError}
            getKey={(item) => item.id}
            renderOption={(item) => (
              <>
                <span className="mono">{item.code}</span> <small>{item.name}</small>
              </>
            )}
            onSelect={(item) => {
              setPeer({ id: item.id, code: item.code });
              setQuery(item.code);
            }}
          />
        </Field>

        {!peer ? (
          <Field label={t('ports.freeText')} hint={t('ports.freeTextHint')} htmlFor="port-free">
            <input
              id="port-free"
              className="inp"
              value={connectedLabel}
              onChange={(e) => setConnectedLabel(e.target.value)}
            />
          </Field>
        ) : null}

        <Field label={t('ports.peerPort')} htmlFor="port-peer-port">
          <input
            id="port-peer-port"
            className="inp mono"
            value={connectedPort}
            onChange={(e) => setConnectedPort(e.target.value)}
          />
        </Field>
        <Field label={t('ports.vlan')} hint={t('ports.vlanHint')} htmlFor="port-vlan">
          <input
            id="port-vlan"
            className="inp mono"
            placeholder="20"
            value={vlan}
            onChange={(e) => setVlan(e.target.value)}
          />
        </Field>

        <Field label={t('ports.usedBy')}>
          {/* Cùng danh mục Bộ phận với ô "ai đang dùng" của hồ sơ IP và của sổ NAT — ba chỗ
              trả lời cùng một câu, viết lệch nhau thì tra chéo không ra. */}
          <SuggestInput
            value={usedBy}
            onChange={setUsedBy}
            options={departments.names}
            failed={departments.failed}
            placeholder={t('ports.usedByPlaceholder')}
            ariaLabel={t('ports.usedBy')}
          />
        </Field>
        <Field label={t('ports.note')} htmlFor="port-note">
          <input
            id="port-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
