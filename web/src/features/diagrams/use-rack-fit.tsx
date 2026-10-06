import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import { useToast } from '@/ui/toast';
import type { DiagramDeviceInfo } from './diagram-api';
import type { BarAction } from './diagram-bar';
import { escapeXmlAttr, pageIds } from './drawio-bridge';
import { cellBox, columnPlacement, outsidePlacement, rackFit, type CellMove, type RackFitDevice, type RackMismatch } from './rack-fit';
import { RackMoveDialog, RackMoveListDialog, type RackMoved } from './rack-move-dialog';

function toFit(info: DiagramDeviceInfo): RackFitDevice & { retired: boolean } {
  return {
    code: info.code ?? '',
    cabinetId: info.cabinetId ?? null,
    cabinetCode: info.cabinetCode,
    u: info.u,
    uSize: info.uSize,
    rackLabel: info.rackLabel ?? null,
    freeLabel: info.cell?.label ?? null,
    freeSize: info.cell ? { width: info.cell.width, height: info.cell.height } : null,
    retired: info.status === 'retired',
  };
}

/**
 * Hộp đang mở: `move` = máy tủ khác (Hủy → ô ra ngoài khung), `declare` = máy cùng tủ chưa khai U
 * (Hủy → ô vào cột "Chưa khai U"). `dragged` = vừa kéo vào khung (nút Hủy nói rõ ô đi đâu).
 */
interface Moving {
  item: RackMismatch;
  kind: 'move' | 'declare';
  dragged: boolean;
}

/** Cột "Chưa khai U" của server (`editor-settings`) — dựng khi Hủy khai U mà trang chưa có cột. */
export interface RackColumnSpec {
  style: string;
  width: number;
  top: number;
  bottom: number;
  gap: number;
}

/**
 * Đặt lại máy trong khung tủ (Q-23; luật ở `rack-fit.ts`): cao đúng số U, đúng U của
 * kho (máy khác: U trống gần chỗ thả), ảnh lấp ô U, nhãn một dòng bên phải. Sửa bằng `patch` —
 * draw.io không gửi lại `autosave` cho `patch`, nên không vòng lặp. Lúc MỞ bản vẽ cũng đặt lại trên
 * trình vẽ (một máy nằm trong khung mà không theo U là hình tủ sai) nhưng không tính là thay đổi:
 * nút Lưu không bật vì IMS sửa hình; người vẽ lưu lần sau thì chỗ đúng được lưu theo.
 *
 * Máy kho ghi tủ khác khung: vừa KÉO vào khung thì mở ngay hộp "Chuyển máy sang tủ này?" — chưa
 * ghi gì; Hủy đưa ô RA khỏi khung (cạnh khung). Có sẵn trong bản vẽ lúc mở thì chỉ báo, lời báo có
 * nút mở cùng hộp; menu có "Chuyển máy sang tủ…" liệt kê mọi máy như thế. Máy cùng tủ chưa khai U
 * vừa kéo vào khung thì hỏi khai U (cùng hộp); Hủy đưa ô vào cột "Chưa khai U" của tủ.
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
  rackColumn,
}: {
  devices: DiagramDeviceInfo[];
  /** XML lúc mở — lượt đọc lại (sau khi hỏi server thông tin máy) dùng nó tới `autosave` đầu tiên. */
  initialXml: string;
  /** Cột "Chưa khai U" (server) — vắng ở server cũ thì Hủy khai U đưa ô ra ngoài khung. */
  rackColumn?: RackColumnSpec;
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
  const latest = useRef(initialXml);
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
          action: { label: t('diagrams.rack.moveAction'), onClick: () => ask([{ item, kind: 'move', dragged: false }]) },
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
      ask(movable.map((item) => ({ item, kind: 'move', dragged: true })));
    }
    const noU = result.noU.filter((item) => !warned.current.has(`u:${item.cellId}`));
    for (const item of noU) warned.current.add(`u:${item.cellId}`);
    const declarable = noU.filter((item) => !known.current.get(item.deviceId)?.retired);
    if (options.warnOnly || declarable.length === 0) {
      if (noU.length > 0) toast({ tone: 'warn', message: t('diagrams.rack.noU', { code: noU.map((item) => item.code).join(', ') }) });
    } else {
      // Vừa kéo máy chưa khai U vào khung tủ của nó: hỏi U ngay (ghi kho chỉ khi đồng ý).
      ask(declarable.map((item) => ({ item, kind: 'declare', dragged: true })));
    }
    const updates = options.only ? Object.fromEntries(Object.entries(result.updates).filter(([id]) => id === options.only)) : result.updates;
    if (Object.keys(updates).length === 0) return;
    if (options.warnOnly) {
      // Lúc mở: đặt lại trên trình vẽ, KHÔNG tính là thay đổi của người vẽ (xem chú thích hook).
      patchCells(updates);
      return;
    }
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

  /** Dựng cột "Chưa khai U" cạnh khung rồi đưa ô vào — một lệnh `patch` (draw.io chèn trước, sửa sau). */
  const intoNewColumn = (file: string, item: RackMismatch, pageId: string) => {
    const frame = outsidePlacement(file, item.cellId, known.current.get(item.deviceId));
    if (!rackColumn || !frame) return false;
    const info = known.current.get(item.deviceId);
    const size = info?.freeSize ?? { width: 60, height: 60 };
    const frameBox = cellBox(file, item.frameId);
    if (!frameBox) return false;
    const columnId = `ims-col-${item.frameCabinetId}-${Date.now().toString(36)}`;
    const label = t('diagrams.rack.columnLabel', { code: info?.cabinetCode ?? '' });
    const x = frameBox.x + frameBox.width + rackColumn.gap;
    const marginLeft = Number(/marginLeft=(\d+)/.exec(rackColumn.style)?.[1] ?? 0);
    send({
      action: 'patch',
      patch: {
        u: {
          [pageId]: {
            cells: {
              i: [
                {
                  id: columnId,
                  vertex: 1,
                  parent: frame.parent,
                  previous: item.frameId,
                  style: rackColumn.style,
                  geometry: `<mxGeometry x="${Math.round(x)}" y="${Math.round(frameBox.y)}" width="${rackColumn.width}" height="${Math.round(rackColumn.top + size.height + rackColumn.bottom)}" as="geometry"/>`,
                  xmlValue: `<UserObject label="${escapeXmlAttr(label)}" ims_cabinet_id="${escapeXmlAttr(item.frameCabinetId)}" id="${escapeXmlAttr(columnId)}"/>`,
                },
              ],
              u: {
                [item.cellId]: {
                  ...frame,
                  parent: columnId,
                  previous: '',
                  geometry: `<mxGeometry x="${marginLeft}" y="${rackColumn.top}" width="${size.width}" height="${size.height}" as="geometry"/>`,
                },
              },
            },
          },
        },
      },
    });
    return true;
  };

  const onCancel = () => {
    const current = moving;
    close();
    if (!current) return;
    const { item, kind } = current;
    // Ô đã ra khỏi khung: kéo lại vào đúng khung đó là một lần hỏi mới.
    warned.current.delete(`cab:${item.cellId}:${item.frameId}`);
    warned.current.delete(`u:${item.cellId}`);
    withFile((file) => {
      const id = pageId(file);
      if (!id) return;
      const info = known.current.get(item.deviceId);
      let move: CellMove | null = null;
      if (kind === 'declare') {
        move = columnPlacement(file, item.cellId, item.frameCabinetId, info);
        if (!move && intoNewColumn(file, item, id)) {
          markDirty();
          return;
        }
      }
      move = move ?? outsidePlacement(file, item.cellId, info);
      if (!move) return;
      send({ action: 'patch', patch: { u: { [id]: { cells: { u: { [item.cellId]: move } } } } } });
      markDirty();
    });
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
            ask([{ item, kind: 'move', dragged: false }]);
          }}
        />
      ) : null}
      {moving ? (
        <RackMoveDialog key={moving.item.cellId} item={moving.item} kind={moving.kind} csrfToken={csrfToken} revert={moving.dragged} onMoved={onMoved} onClose={onCancel} />
      ) : null}
    </>
  );

  return { fit, menu, dialogs };
}
