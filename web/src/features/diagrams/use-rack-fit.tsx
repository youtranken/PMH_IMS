import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import { useToast } from '@/ui/toast';
import type { DiagramDeviceInfo } from './diagram-api';
import { pageIds } from './drawio-bridge';
import { rackFit, type RackFitDevice } from './rack-fit';

function toFit(info: DiagramDeviceInfo): RackFitDevice {
  return { code: info.code ?? '', cabinetId: info.cabinetId ?? null, cabinetCode: info.cabinetCode, u: info.u, uSize: info.uSize };
}

/**
 * Đặt lại máy trong khung tủ sau mỗi `autosave` (Q-23 05/10, luật ở `rack-fit.ts`): cao đúng số U,
 * đúng U của kho, nhãn bên phải. Máy kho ghi tủ khác / chưa khai U thì báo MỘT lần cho mỗi ô, không
 * đặt theo U và không ghi gì vào kho. Sửa bằng `patch` — draw.io không gửi lại `autosave` cho
 * `patch`, nên không vòng lặp.
 */
export function useRackFit({
  devices,
  withFile,
  send,
  page,
}: {
  devices: DiagramDeviceInfo[];
  withFile: (fn: (xml: string) => void) => void;
  send: (command: DrawioCommand) => void;
  page: () => number;
}): (xml: string) => void {
  const { t } = useTranslation();
  const toast = useToast();
  const known = useRef(new Map(devices.filter((d) => d.found).map((d) => [d.id, toFit(d)])));
  const asked = useRef(new Set<string>());
  const warned = useRef(new Set<string>());
  const latest = useRef('');

  const fit = (xml: string) => {
    latest.current = xml;
    const result = rackFit(xml, known.current);
    const missing = result.unknown.filter((id) => !asked.current.has(id));
    if (missing.length > 0) {
      for (const id of missing) asked.current.add(id);
      void apiFetch<DiagramDeviceInfo[]>(`/api/v1/diagrams/device-info?ids=${missing.map(encodeURIComponent).join(',')}`)
        .then((infos) => {
          for (const info of infos) if (info.found) known.current.set(info.id, toFit(info));
          fit(latest.current);
        })
        .catch(() => undefined);
    }
    for (const item of result.cabinetMismatch) {
      if (warned.current.has(`cab:${item.cellId}`)) continue;
      warned.current.add(`cab:${item.cellId}`);
      toast({
        tone: 'warn',
        message: t('diagrams.rack.cabinetMismatch', { code: item.code, cabinet: item.deviceCabinet ?? t('diagrams.rack.noCabinet'), frame: item.frameLabel }),
      });
    }
    for (const item of result.noU) {
      if (warned.current.has(`u:${item.cellId}`)) continue;
      warned.current.add(`u:${item.cellId}`);
      toast({ tone: 'warn', message: t('diagrams.rack.noU', { code: item.code }) });
    }
    if (Object.keys(result.updates).length === 0) return;
    withFile((file) => {
      const pages = pageIds(file);
      const pageId = pages[Math.min(page(), pages.length - 1)];
      if (pageId) send({ action: 'patch', patch: { u: { [pageId]: { cells: { u: result.updates } } } } });
    });
  };
  return fit;
}
