import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { freePorts, linksBetween, nextFreePort, portTakenBy, usedPorts, type PortLink, type PortMap } from '@/lib/port-types';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import type { NewEdge } from './cable-diff';
import type { CableTypeInfo, DiagramLink } from './diagram-api';

/** Loại dây dùng gần nhất — người vẽ thường nối cả loạt cùng một loại dây. */
const LAST_CABLE_KEY = 'ims.diagrams.lastCableType';

function lastCable(): string {
  try {
    return window.localStorage.getItem(LAST_CABLE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberCable(id: string): void {
  try {
    window.localStorage.setItem(LAST_CABLE_KEY, id);
  } catch {
    // Trình duyệt chặn lưu trữ: lần sau chỉ không có mặc định, không sao.
  }
}

export const portsKey = (deviceId: string) => ['devices', deviceId, 'ports'] as const;

/** Dòng sơ đồ cổng theo id → dây kèm nhãn + style do server dựng (cùng luật hydrate). */
export async function fetchDiagramLinks(ids: string[]): Promise<DiagramLink[]> {
  if (ids.length === 0) return [];
  return apiFetch<DiagramLink[]>(`/api/v1/diagrams/links?ids=${ids.map(encodeURIComponent).join(',')}`);
}

/**
 * Hộp "Khai kết nối này vào sơ đồ cổng?" (Q-23 "vẽ là khai, có hỏi"). Mở khi cầu nối thấy một nét
 * MỚI nối hai máy kho. "Khai" = WEB gọi endpoint ghi của `devices` (luật một cổng một cáp ở đó);
 * lỗi (409 cổng đã có cáp, 403) hiện ngay trong hộp, danh sách cổng trống nạp lại, không gắn gì vào
 * nét. "Chỉ vẽ" hay đóng hộp (✕/Esc) = để nét không khai, đánh dấu vàng.
 */
export function CableDeclareDialog({
  me,
  edge,
  cableTypes,
  onDeclared,
  onBind,
  onDrawOnly,
}: {
  me: Me;
  edge: NewEdge;
  /** Mọi loại dây (kể cả ngừng dùng); hộp chỉ cho chọn loại còn dùng (Q-14). */
  cableTypes: CableTypeInfo[];
  /** Khai xong: dây vừa ghi (nhãn, style) để gắn vào nét. */
  onDeclared: (link: DiagramLink) => void;
  /** Gắn nét vào một dòng sơ đồ cổng có sẵn giữa đúng hai máy — không ghi gì. */
  onBind: (link: DiagramLink) => void;
  onDrawOnly: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const source = { id: edge.sourceDeviceId, code: edge.sourceCode };
  const target = { id: edge.targetDeviceId, code: edge.targetCode };
  const sourcePorts = useQuery({ queryKey: portsKey(source.id), queryFn: () => apiFetch<PortMap>(`/api/v1/devices/${source.id}/ports`) });
  const targetPorts = useQuery({ queryKey: portsKey(target.id), queryFn: () => apiFetch<PortMap>(`/api/v1/devices/${target.id}/ports`) });
  const active = cableTypes.filter((c) => c.active);
  const remembered = lastCable();
  const [sourcePort, setSourcePort] = useState('');
  const [targetPort, setTargetPort] = useState('');
  const [cableTypeId, setCableTypeId] = useState(active.some((c) => c.id === remembered) ? remembered : '');
  const [error, setError] = useState<string | null>(null);
  /** Lỗi 409 của server gắn vào ô của máy mà nó nói tới — gõ lại ô đó thì lỗi đi. */
  const [serverError, setServerError] = useState<{ side: 'source' | 'target'; message: string } | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const existing = linksBetween(sourcePorts.data, source, target.id);

  /*
   * Luật một cổng một cáp báo NGAY tại ô (server vẫn là bên kiểm cuối): gõ lại cổng đã có cáp là lỗi
   * hay gặp nhất khi nối máy thứ ba vào một máy đã có dây.
   */
  const takenText = (code: string, map: PortMap | undefined, port: string) => {
    const peer = portTakenBy(map, port);
    return peer ? t('diagrams.cable.portTaken', { port: port.trim(), code, peer }) : null;
  };
  const sourceTaken = takenText(source.code, sourcePorts.data, sourcePort);
  const targetTaken = takenText(target.code, targetPorts.data, targetPort);
  const portStatus = (code: string, map: PortMap | undefined) => {
    if (!map) return undefined;
    const used = usedPorts(map);
    if (map.ports.length === 0 && used.length === 0) return t('diagrams.cable.noPortsYet', { code });
    if (used.length === 0) return t('diagrams.cable.freePortsHint');
    return t('diagrams.cable.usedPorts', { code, ports: used.map((u) => `${u.label} → ${u.peer}`).join(', ') });
  };
  const fixes = [
    sourceTaken ? { side: 'source' as const, code: source.code, next: nextFreePort(sourcePorts.data, sourcePort) } : null,
    targetTaken ? { side: 'target' as const, code: target.code, next: nextFreePort(targetPorts.data, targetPort) } : null,
  ].filter((fix): fix is { side: 'source' | 'target'; code: string; next: string } => Boolean(fix?.next));

  const reloadPorts = () => {
    void queryClient.invalidateQueries({ queryKey: portsKey(source.id) });
    void queryClient.invalidateQueries({ queryKey: portsKey(target.id) });
  };

  const declare = async () => {
    setError(null);
    if (!sourcePort.trim()) {
      setMissing(true);
      return;
    }
    if (sourceTaken || targetTaken) return;
    setBusy(true);
    try {
      const link = await apiFetch<PortLink>(`/api/v1/devices/${source.id}/ports/link`, {
        method: 'POST',
        csrfToken: me.csrfToken,
        body: JSON.stringify({
          portLabel: sourcePort.trim(),
          connectedDeviceId: target.id,
          connectedPort: targetPort.trim(),
          cableTypeId,
        }),
      });
      if (cableTypeId) rememberCable(cableTypeId);
      reloadPorts();
      const [info] = await fetchDiagramLinks([link.id]);
      if (info) onDeclared(info);
    } catch (err) {
      // Không ghi gì, không gắn gì vào nét: chọn cổng khác hoặc bấm "Chỉ vẽ".
      const code = errorCode(err);
      const message = errorMessage(err);
      if (code === 'PORT_PEER_TAKEN' || code === 'PORT_ALREADY_LINKED') {
        // Câu 409 nêu mã máy đang giữ cổng; chỉ nêu máy đầu kia (không nêu máy này) là cổng đầu kia.
        const side = code === 'PORT_PEER_TAKEN' || (message.includes(target.code) && !message.includes(source.code)) ? 'target' : 'source';
        setServerError({ side, message });
      } else setError(message);
      reloadPorts();
    } finally {
      setBusy(false);
    }
  };

  const bind = async (id: string) => {
    setError(null);
    setBusy(true);
    try {
      const [info] = await fetchDiagramLinks([id]);
      if (info) onBind(info);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onDrawOnly();
      }}
      dismissible={!busy}
      maxWidth={620}
      title={t('diagrams.cable.declareTitle')}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onDrawOnly}>
            {t('diagrams.cable.drawOnly')}
          </button>
          <button type="submit" form="cable-declare-form" className="btn primary" disabled={busy}>
            {busy ? t('diagrams.cable.declaring') : t('diagrams.cable.declare')}
          </button>
        </>
      }
    >
      <form
        id="cable-declare-form"
        className="form-grid"
        data-columns={2}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void declare();
        }}
      >
        {error ? (
          <p className="alert error" role="alert" style={{ gridColumn: '1 / -1' }}>
            {error}
          </p>
        ) : null}
        <p className="muted" style={{ gridColumn: '1 / -1' }}>
          {t('diagrams.cable.declareHint')}
        </p>
        <Field
          label={t('diagrams.cable.portOf', { code: source.code })}
          required
          hint={portStatus(source.code, sourcePorts.data)}
          error={
            missing && !sourcePort.trim()
              ? t('diagrams.cable.portRequired', { code: source.code })
              : (sourceTaken ?? (serverError?.side === 'source' ? serverError.message : undefined))
          }
        >
          <SuggestInput
            value={sourcePort}
            onChange={(value) => {
              setSourcePort(value);
              if (serverError?.side === 'source') setServerError(null);
            }}
            options={freePorts(sourcePorts.data)}
            failed={sourcePorts.isError}
            placeholder={t('ports.phPort')}
            ariaLabel={t('diagrams.cable.portOf', { code: source.code })}
          />
        </Field>
        <Field
          label={t('diagrams.cable.portOf', { code: target.code })}
          hint={portStatus(target.code, targetPorts.data)}
          error={targetTaken ?? (serverError?.side === 'target' ? serverError.message : undefined)}
        >
          <SuggestInput
            value={targetPort}
            onChange={(value) => {
              setTargetPort(value);
              if (serverError?.side === 'target') setServerError(null);
            }}
            options={freePorts(targetPorts.data)}
            failed={targetPorts.isError}
            placeholder={t('ports.phPort')}
            ariaLabel={t('diagrams.cable.portOf', { code: target.code })}
          />
        </Field>
        {fixes.length > 0 ? (
          <p className="cable-port-fixes" style={{ gridColumn: '1 / -1' }}>
            {fixes.map((fix) => (
              <button
                key={fix.side}
                type="button"
                className="btn sm"
                onClick={() => (fix.side === 'source' ? setSourcePort(fix.next) : setTargetPort(fix.next))}
              >
                {t('diagrams.cable.useNext', { port: fix.next, code: fix.code })}
              </button>
            ))}
          </p>
        ) : null}
        <Field label={t('diagrams.cable.cableType')}>
          <Select
            value={cableTypeId}
            onChange={setCableTypeId}
            ariaLabel={t('diagrams.cable.cableType')}
            options={[{ value: '', label: t('diagrams.cable.cableTypeNone') }, ...active.map((c) => ({ value: c.id, label: c.name }))]}
          />
        </Field>
      </form>
      {existing.length > 0 ? (
        <section aria-label={t('diagrams.cable.existingTitle')}>
          <h3 className="form-section-title">{t('diagrams.cable.existingTitle')}</h3>
          <ul className="device-card-diagrams">
            {existing.map((link) => {
              const label = `${link.deviceCode} ${link.portLabel} ↔ ${link.peerDeviceCode} ${link.peerPort ?? '—'}`;
              return (
                <li key={link.id}>
                  <button type="button" className="linkbtn" disabled={busy} onClick={() => void bind(link.id)}>
                    {t('diagrams.cable.bindExisting', { label })}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </Dialog>
  );
}
