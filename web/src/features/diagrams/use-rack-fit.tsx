import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import { useToast } from '@/ui/toast';
import type { DiagramDeviceInfo } from './diagram-api';
import type { BarAction } from './diagram-bar';
import { pageIds } from './drawio-bridge';
import { cellPlacement, rackFit, type RackFitDevice, type RackMismatch } from './rack-fit';
import { RackMoveDialog, RackMoveListDialog, type RackMoved } from './rack-move-dialog';

function toFit(info: DiagramDeviceInfo): RackFitDevice & { retired: boolean } {
  return { code: info.code ?? '', cabinetId: info.cabinetId ?? null, cabinetCode: info.cabinetCode, u: info.u, uSize: info.uSize, retired: info.status === 'retired' };
}

/** Hộp chuyển đang mở: `revert` = chỗ cũ của ô vừa kéo vào khung (Huỷ đưa về đó). */
interface Moving {
  item: RackMismatch;
  revert: { parent: string; previous: string; geometry: string } | null;
}

/**
 * Đặt lại máy trong khung tủ sau mỗi `autosave` (Q-23 05/10, luật ở `rack-fit.ts`): cao đúng số U,
 * đúng U của kho, nhãn bên phải. Sửa bằng `patch` — draw.io không gửi lại `autosave` cho `patch`,
 * nên không vòng lặp.
 *
 * Máy kho ghi tủ khác khung (Q-23 06/10): vừa KÉO vào khung thì mở ngay hộp "Chuyển máy sang tủ
 * này?" — chưa ghi gì; Huỷ đưa ô về chỗ cũ. Có sẵn trong bản vẽ lúc mở thì chỉ báo, lời báo có nút
 * mở cùng hộp; menu có "Chuyển máy sang tủ…" liệt kê mọi máy như thế. Máy chưa khai U thì báo MỘT
 * lần cho mỗi ô.
 */
export function useRackFit({
  devices,
  initialXml,
  csrfToken,
  ready,
  withFile,
  send,
  page,
  markDirty,
}: {
  devices: DiagramDeviceInfo[];
  /** XML lúc mở — chỗ cũ của ô khi người vẽ huỷ chuyển tủ ngay lượt kéo đầu tiên. */
  initialXml: string;
  csrfToken: string;
  ready: boolean;
  withFile: (fn: (xml: string) => void) => void;
  send: (command: DrawioCommand) => void;
  page: () => number;
  markDirty: () => void;
}): { fit: (xml: string, options?: { warnOnly?: boolean }) => void; menu: BarAction[]; dialogs: ReactNode } {
  const { t } = useTranslation();
  const toast = useToast();
  const known = useRef(new Map(devices.filter((d) => d.found).map((d) => [d.id, toFit(d)])));
  const asked = useRef(new Set<string>());
  const warned = useRef(new Set<string>());
  const latest = useRef('');
  // XML của lượt `autosave` TRƯỚC: ô vừa kéo vào khung còn ở chỗ cũ trong đó.
  const previous = useRef(initialXml);
  const [moving, setMoving] = useState<Moving | null>(null);
  const queue = useRef<Moving[]>([]);
  // Hộp đang mở hay không, đọc được ngay trong cùng lượt (state `moving` chỉ đổi ở lần vẽ sau).
  const open = useRef(false);
  const [listing, setListing] = useState<RackMismatch[] | null>(null);

  const pageId = (file: string) => {
    const pages = pageIds(file);
    return pages[Math.min(page(), pages.length - 1)] ?? null;
  };
  const patchCells = (cells: Record<string, unknown>) =>
    withFile((file) => {
      const id = pageId(file);
      if (id) send({ action: 'patch', patch: { u: { [id]: { cells: { u: cells } } } } });
    });

  const openNext = () => {
    const next = queue.current.shift() ?? null;
    open.current = next !== null;
    setMoving(next);
  };
  const ask = (items: Moving[]) => {
    queue.current.push(...items);
    if (!open.current) openNext();
  };

  const fit = (xml: string, options: { warnOnly?: boolean; only?: string } = {}) => {
    latest.current = xml;
    const before = previous.current;
    if (!options.only) previous.current = xml;
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
    // Khoá theo ô + khung: kéo cùng ô sang khung của tủ thứ ba là một lần hỏi mới.
    const key = (item: RackMismatch) => `cab:${item.cellId}:${item.frameId}`;
    const fresh = result.cabinetMismatch.filter((item) => !warned.current.has(key(item)));
    for (const item of fresh) warned.current.add(key(item));
    const retired = fresh.filter((item) => known.current.get(item.deviceId)?.retired);
    const movable = fresh.filter((item) => !known.current.get(item.deviceId)?.retired);
    if (retired.length > 0) toast({ tone: 'warn', message: retired.map((item) => t('diagrams.rack.moveRetired', { code: item.code })).join(' ') });
    if (options.warnOnly) {
      // Mở một bản vẽ cũ có cả loạt máy lệch: MỘT lời báo liệt kê, không một chuỗi lời báo.
      const cabinetOf = (item: RackMismatch) => item.deviceCabinet ?? t('diagrams.rack.noCabinet');
      if (movable.length === 1) {
        const [item] = movable;
        toast({
          tone: 'warn',
          message: t('diagrams.rack.cabinetMismatch', { code: item.code, cabinet: cabinetOf(item), frame: item.frameLabel }),
          action: { label: t('diagrams.rack.moveAction'), onClick: () => ask([{ item, revert: null }]) },
        });
      } else if (movable.length > 1) {
        const list = movable.map((item) => `${item.code} (${cabinetOf(item)})`).join(', ');
        toast({
          tone: 'warn',
          message: t('diagrams.rack.cabinetMismatchMany', { count: movable.length, list }),
          action: { label: t('diagrams.rack.moveListAction'), onClick: () => setListing(movable) },
        });
      }
    } else if (movable.length > 0) {
      // Vừa kéo vào khung của tủ khác: hỏi ngay, chưa ghi gì vào kho.
      ask(movable.map((item) => ({ item, revert: cellPlacement(before, item.cellId) })));
    }
    const noU = result.noU.filter((item) => !warned.current.has(`u:${item.cellId}`));
    for (const item of noU) warned.current.add(`u:${item.cellId}`);
    if (noU.length > 0) toast({ tone: 'warn', message: t('diagrams.rack.noU', { code: noU.map((item) => item.code).join(', ') }) });
    // Lúc mở chỉ báo: bản vẽ không bị sửa khi người vẽ chưa đụng gì (sửa lúc đó là thay đổi chưa
    // lưu mà nút Lưu không biết).
    const updates = options.only ? Object.fromEntries(Object.entries(result.updates).filter(([id]) => id === options.only)) : result.updates;
    if (options.warnOnly || Object.keys(updates).length === 0) return;
    // Ô "nhảy" về U của kho ngay sau khi thả: nói một lần vì sao, và muốn dời thì sửa ở đâu.
    if (!options.only && !warned.current.has('snap') && Object.values(updates).some((u) => u.geometry)) {
      warned.current.add('snap');
      toast({ tone: 'ok', message: t('diagrams.rack.snapped') });
    }
    patchCells(updates);
    if (options.only) markDirty();
  };

  const close = () => {
    open.current = false;
    setMoving(null);
    if (queue.current.length > 0) window.setTimeout(openNext, 0);
  };

  const onCancel = () => {
    const current = moving;
    if (current?.revert) {
      patchCells({ [current.item.cellId]: current.revert });
      // Ô đã về chỗ cũ: kéo lại vào đúng khung đó là một lần hỏi mới.
      warned.current.delete(`cab:${current.item.cellId}:${current.item.frameId}`);
    }
    close();
  };

  const onMoved = (moved: RackMoved) => {
    const current = moving;
    const info = known.current.get(moved.deviceId);
    if (info) known.current.set(moved.deviceId, { ...info, cabinetId: moved.cabinetId, cabinetCode: moved.cabinetCode, u: moved.u, uSize: moved.uSize });
    if (current) fit(latest.current, { only: current.item.cellId });
    close();
  };

  const menu: BarAction[] = [
    {
      key: 'rack-move',
      label: t('diagrams.rack.moveListAction'),
      disabled: !ready,
      onSelect: () => withFile((file) => setListing(rackFit(file, known.current).cabinetMismatch.filter((item) => !known.current.get(item.deviceId)?.retired))),
    },
  ];

  const dialogs = (
    <>
      {listing ? (
        <RackMoveListDialog
          items={listing}
          onClose={() => setListing(null)}
          onPick={(item) => {
            setListing(null);
            ask([{ item, revert: null }]);
          }}
        />
      ) : null}
      {moving ? <RackMoveDialog key={moving.item.cellId} item={moving.item} csrfToken={csrfToken} revert={Boolean(moving.revert)} onMoved={onMoved} onClose={onCancel} /> : null}
    </>
  );

  return { fit, menu, dialogs };
}
