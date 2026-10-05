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
}): (xml: string, options?: { warnOnly?: boolean }) => void {
  const { t } = useTranslation();
  const toast = useToast();
  const known = useRef(new Map(devices.filter((d) => d.found).map((d) => [d.id, toFit(d)])));
  const asked = useRef(new Set<string>());
  const warned = useRef(new Set<string>());
  const latest = useRef('');

  const fit = (xml: string, options: { warnOnly?: boolean } = {}) => {
    latest.current = xml;
    const result = rackFit(xml, known.current);
    const missing = result.unknown.filter((id) => !asked.current.has(id));
    if (missing.length > 0) {
      for (const id of missing) asked.current.add(id);
      void apiFetch<DiagramDeviceInfo[]>(`/api/v1/diagrams/device-info?ids=${missing.map(encodeURIComponent).join(',')}`)
        .then((infos) => {
          for (const info of infos) if (info.found) known.current.set(info.id, toFit(info));
          fit(latest.current, options);
        })
        .catch(() => undefined);
    }
    // Mở một bản vẽ cũ có cả loạt máy lệch: MỘT lời báo liệt kê, không một chuỗi lời báo.
    const mismatch = result.cabinetMismatch.filter((item) => !warned.current.has(`cab:${item.cellId}`));
    for (const item of mismatch) warned.current.add(`cab:${item.cellId}`);
    const cabinetOf = (item: (typeof mismatch)[number]) => item.deviceCabinet ?? t('diagrams.rack.noCabinet');
    if (mismatch.length === 1) {
      const [item] = mismatch;
      toast({ tone: 'warn', message: t('diagrams.rack.cabinetMismatch', { code: item.code, cabinet: cabinetOf(item), frame: item.frameLabel }) });
    } else if (mismatch.length > 1) {
      const list = mismatch.map((item) => `${item.code} (${cabinetOf(item)})`).join(', ');
      toast({ tone: 'warn', message: t('diagrams.rack.cabinetMismatchMany', { count: mismatch.length, list }) });
    }
    const noU = result.noU.filter((item) => !warned.current.has(`u:${item.cellId}`));
    for (const item of noU) warned.current.add(`u:${item.cellId}`);
    if (noU.length > 0) toast({ tone: 'warn', message: t('diagrams.rack.noU', { code: noU.map((item) => item.code).join(', ') }) });
    // Lúc mở chỉ báo: bản vẽ không bị sửa khi người vẽ chưa đụng gì (sửa lúc đó là thay đổi chưa
    // lưu mà nút Lưu không biết).
    if (options.warnOnly || Object.keys(result.updates).length === 0) return;
    // Ô "nhảy" về U của kho ngay sau khi thả: nói một lần vì sao, và muốn dời thì sửa ở đâu.
    if (!warned.current.has('snap') && Object.values(result.updates).some((u) => u.geometry)) {
      warned.current.add('snap');
      toast({ tone: 'ok', message: t('diagrams.rack.snapped') });
    }
    withFile((file) => {
      const pages = pageIds(file);
      const pageId = pages[Math.min(page(), pages.length - 1)];
      if (pageId) send({ action: 'patch', patch: { u: { [pageId]: { cells: { u: result.updates } } } } });
    });
  };
  return fit;
}
