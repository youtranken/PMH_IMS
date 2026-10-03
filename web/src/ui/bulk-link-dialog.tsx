import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { PortLink } from '@/lib/port-types';
import { DeviceCombobox } from '@/ui/device-combobox';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useDebouncedValue } from '@/ui/use-debounced-value';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';

/**
 * "Nối hàng loạt" (Story 10.5): một switch + N máy, cổng bắt đầu → bảng xem trước "máy → cổng"
 * do SERVER chia (bỏ qua cổng đã có cáp), rồi ghi cả lô trong MỘT transaction qua endpoint của
 * `devices` — không đủ cổng hay vướng luật một cổng một cáp thì không ghi máy nào. Dùng ở trang
 * thiết bị và màn sơ đồ mạng (AD-15).
 */
export function BulkLinkDialog({
  device,
  csrfToken,
  onClose,
  onDone,
}: {
  /** Switch cố định (trang thiết bị); `null` = cho chọn (màn sơ đồ). */
  device: { id: string; code: string } | null;
  csrfToken: string;
  onClose: () => void;
  onDone: (links: PortLink[], switchCode: string) => void;
}) {
  const { t } = useTranslation();
  const lists = useCatalogLists();
  const [sw, setSw] = useState<{ id: string; code: string } | null>(device);
  const [swTerm, setSwTerm] = useState(device?.code ?? '');
  const [targets, setTargets] = useState<{ id: string; code: string }[]>([]);
  const [targetTerm, setTargetTerm] = useState('');
  const [startPort, setStartPort] = useState('');
  const [endPort, setEndPort] = useState('');
  const [peerPort, setPeerPort] = useState('');
  const [cableTypeId, setCableTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = useDebouncedValue(startPort.trim());
  const end = useDebouncedValue(endPort.trim());
  const ready = Boolean(sw && start && targets.length > 0);
  const plan = useQuery({
    queryKey: ['devices', sw?.id ?? '', 'ports', 'bulk-plan', start, end, targets.length],
    enabled: ready,
    queryFn: () => {
      if (!sw) return Promise.resolve({ ports: [], reason: null });
      const params = new URLSearchParams({ startPort: start, count: String(targets.length) });
      if (end) params.set('endPort', end);
      return apiFetch<{ ports: string[]; reason: string | null }>(`/api/v1/devices/${sw.id}/ports/bulk-plan?${params.toString()}`);
    },
  });
  const canSubmit = ready && plan.data && !plan.data.reason && !busy;

  const submit = async () => {
    if (!sw || !canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const links = await apiFetch<PortLink[]>(`/api/v1/devices/${sw.id}/ports/bulk-link`, {
        method: 'POST',
        csrfToken,
        body: JSON.stringify({
          startPort: startPort.trim(),
          endPort: endPort.trim(),
          targets: targets.map((d) => d.id),
          peerPort: peerPort.trim(),
          cableTypeId,
        }),
      });
      onDone(links, sw.code);
    } catch (err) {
      setError(errorMessage(err));
      void plan.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={680}
      title={device ? t('common.titleOf', { action: t('ports.bulkTitle'), subject: device.code }) : t('ports.bulkTitle')}
      footer={
        <>
          <DialogCancel>{t('common.cancel')}</DialogCancel>
          <button type="button" className="btn primary" disabled={!canSubmit} onClick={() => void submit()}>
            {t('ports.bulkSubmit', { count: targets.length })}
          </button>
        </>
      }
    >
      <div className="form-grid" data-columns={2}>
        {error ? (
          <p className="alert error" role="alert" style={{ gridColumn: '1 / -1' }}>
            {error}
          </p>
        ) : null}
        {device ? null : (
          <Field label={t('ports.bulkSwitch')} required>
            <DeviceCombobox
              placeholder={t('ports.peerSearch')}
              ariaLabel={t('ports.bulkSwitch')}
              value={{ deviceId: sw?.id ?? '', term: swTerm }}
              onChange={(next) => {
                setSwTerm(next.term);
                setSw(next.device ? { id: next.device.id, code: next.device.code } : null);
              }}
              minChars={2}
            />
          </Field>
        )}
        <Field label={t('ports.bulkStart')} required htmlFor="bulk-start">
          <input id="bulk-start" className="inp mono" placeholder={t('ports.phPort')} value={startPort} onChange={(e) => setStartPort(e.target.value)} />
        </Field>
        <Field label={t('ports.bulkEnd')} htmlFor="bulk-end">
          <input id="bulk-end" className="inp mono" value={endPort} onChange={(e) => setEndPort(e.target.value)} />
        </Field>
        <Field label={t('ports.bulkPeerPort')} htmlFor="bulk-peer">
          <input id="bulk-peer" className="inp mono" value={peerPort} onChange={(e) => setPeerPort(e.target.value)} />
        </Field>
        <Field label={t('ports.cableType')}>
          <Select
            value={cableTypeId}
            onChange={setCableTypeId}
            ariaLabel={t('ports.cableType')}
            options={[{ value: '', label: t('ports.cableTypeNone') }, ...activeOptions(lists.data?.cableTypes, null, (row) => row.name)]}
          />
        </Field>
        <Field label={t('ports.bulkAddTarget')}>
          <DeviceCombobox
            placeholder={t('ports.peerSearch')}
            ariaLabel={t('ports.bulkAddTarget')}
            value={{ deviceId: '', term: targetTerm }}
            onChange={(next) => {
              if (next.device) {
                const picked = { id: next.device.id, code: next.device.code };
                setTargets((list) => [...list, picked]);
                setTargetTerm('');
              } else setTargetTerm(next.term);
            }}
            minChars={2}
            exclude={[...(sw ? [sw.id] : []), ...targets.map((d) => d.id)]}
          />
        </Field>
      </div>
      <section aria-label={t('ports.bulkPreview')}>
        <h3 className="form-section-title">{t('ports.bulkPreview')}</h3>
        {!ready ? (
          <p className="muted">{t('ports.bulkPreviewEmpty')}</p>
        ) : plan.data?.reason ? (
          <p className="alert error" role="alert">
            {plan.data.reason}
          </p>
        ) : (
          <>
            <p className="muted small">{t('ports.bulkSkipHint')}</p>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('ports.fromDevice')}</th>
                  <th>{t('ports.port')}</th>
                  <th>
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {targets.map((target, i) => (
                  <tr key={target.id}>
                    <td className="mono">{target.code}</td>
                    <td className="mono">{plan.data?.ports[i] ?? '…'}</td>
                    <td>
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={() => setTargets((list) => list.filter((d) => d.id !== target.id))}
                      >
                        {t('ports.bulkRemoveTarget', { code: target.code })}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </Dialog>
  );
}
