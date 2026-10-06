import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import { useToast } from '@/ui/toast';
import { CabinetPicker } from './cabinet-picker';
import { BarPopover, type BarAction } from './diagram-bar';
import { lastChildId, layerIdOf, nextInsertPosition, pageIds, type Bounds } from './drawio-bridge';
import { FrameBindDialog } from './frame-bind-dialog';
import { bindFrameValue, cabinetFramePatch, cabinetIdsInXml, frameCandidates, type CabinetFrameLayout, type FrameCandidate } from './frame-bridge';
import { deviceCellsOnPage } from './photo-bridge';

/** `GET /diagrams/cabinet-frame/:id`. */
interface CabinetFrameResponse {
  cabinet: { id: string; code: string };
  layout: CabinetFrameLayout;
}

/**
 * Cầu nối KHUNG của màn sửa (FR-039, AD-18): nút "Chèn tủ" (khung tủ dựng từ kho, chèn bằng
 * `patch`) và "Gắn khung" (gắn một hình đã vẽ với bản vẽ con / dải IP bằng `patch` cập nhật giá trị
 * ô). Khung chỉ là thuộc tính `ims_*` trên hình của draw.io — không ghi bảng kho nào; lưu bản vẽ
 * mới làm khung có hiệu lực, và server kiểm lại khung gắn mới lúc lưu.
 */
export function useFrameBridge({
  diagramId,
  ready,
  xml,
  withFile,
  send,
  page,
  bounds,
  markDirty,
  newId,
  onInserted,
}: {
  diagramId: string;
  ready: boolean;
  /** XML trình vẽ gửi gần nhất — hộp "Chèn tủ" báo tủ đã có khung. */
  xml: string;
  withFile: (fn: (xml: string) => void) => void;
  send: (command: DrawioCommand) => void;
  page: () => number;
  /** Khối hình hiện có, để đặt khung tủ bên phải và nới khối sau khi chèn. */
  bounds: { get: () => Bounds | null; grow: (rect: Bounds) => void };
  markDirty: () => void;
  newId: () => string;
  /** Máy vừa chèn cùng khung tủ — màn cập nhật "đã có" của hộp Thiết bị kho và "kết nối chưa vẽ". */
  onInserted: (deviceIds: string[]) => void;
}): { menu: BarAction[]; popovers: ReactNode; dialogs: ReactNode } {
  const { t } = useTranslation();
  const toast = useToast();
  const [cabinetOpen, setCabinetOpen] = useState(false);
  const [inserting, setInserting] = useState(false);
  /*
   * Tủ vừa chèn bằng `patch` (draw.io không gửi lại `autosave` sau `patch`). Gắn với XML lúc chèn:
   * `autosave` mới tới thì XML đó đã nói đúng tủ nào còn trên bản vẽ (kể cả khi người vẽ xoá khung).
   */
  const [justInserted, setJustInserted] = useState<{ xml: string; ids: string[] }>({ xml, ids: [] });
  const [binding, setBinding] = useState<FrameCandidate[] | null>(null);
  const present = new Set([...cabinetIdsInXml(xml), ...(justInserted.xml === xml ? justInserted.ids : [])]);

  const pageOf = (file: string): string | null => {
    const pages = pageIds(file);
    return pages[Math.min(page(), pages.length - 1)] ?? null;
  };

  const insertCabinet = async (cabinetId: string, code: string) => {
    setInserting(true);
    try {
      const frame = await apiFetch<CabinetFrameResponse>(`/api/v1/diagrams/cabinet-frame/${cabinetId}`);
      withFile((file) => {
        setInserting(false);
        const pageId = pageOf(file);
        if (!pageId) {
          toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: 'page' }) });
          return;
        }
        const parent = layerIdOf(file, pageId) ?? '1';
        const at = nextInsertPosition(bounds.get());
        // Máy của tủ đã có trên trang: dời chính ô đó vào khung (giữ id — dây đã gắn vẫn nối đúng máy).
        const existing = new Map<string, { id: string; style: string }>();
        for (const cell of deviceCellsOnPage(file, pageId)) if (!existing.has(cell.deviceId)) existing.set(cell.deviceId, { id: cell.id, style: cell.style });
        const patch = cabinetFramePatch(frame.layout, { parent, previous: lastChildId(file, pageId, parent), ...at, newId }, existing);
        send({ action: 'patch', patch: { u: { [pageId]: { cells: { i: patch.insert, ...(patch.moved > 0 ? { u: patch.update } : {}) } } } } });
        const right = Math.max(...frame.layout.frames.map((f) => f.x + f.width));
        const bottom = Math.max(...frame.layout.frames.map((f) => f.y + f.height));
        bounds.grow({ ...at, width: right, height: bottom });
        setJustInserted((current) => ({ xml, ids: current.xml === xml ? [...current.ids, cabinetId] : [cabinetId] }));
        markDirty();
        setCabinetOpen(false);
        // Đếm theo máy, không theo ô.
        const deviceIds = [...new Set(frame.layout.devices.map((d) => d.id))];
        onInserted(deviceIds);
        toast({
          tone: 'ok',
          message:
            patch.moved > 0
              ? t('diagrams.frames.cabinetInsertedMoved', { code, count: deviceIds.length, moved: patch.moved })
              : t('diagrams.frames.cabinetInserted', { code, count: deviceIds.length }),
        });
      });
    } catch (error) {
      setInserting(false);
      toast({ tone: 'error', message: errorMessage(error) });
    }
  };

  /** Mở hộp với XML cả tệp mới nhất: hình người vẽ vừa thêm cũng phải có trong danh sách. */
  const openBind = () => withFile((file) => setBinding(frameCandidates(file)));

  const bind = (frame: FrameCandidate, attr: string, value: string | null) => {
    // Đọc lại khung từ tệp HIỆN TẠI: giữa lúc mở hộp và lúc bấm, người vẽ có thể đã sửa chữ trên hình.
    withFile((file) => {
      const pageId = pageOf(file);
      const fresh = frameCandidates(file).find((f) => f.id === frame.id);
      if (!pageId || !fresh) {
        toast({ tone: 'error', message: t('diagrams.screen.insertFailed', { reason: frame.id }) });
        return;
      }
      send({ action: 'patch', patch: { u: { [pageId]: { cells: { u: { [fresh.id]: { xmlValue: bindFrameValue(fresh, { [attr]: value }) } } } } } } });
      markDirty();
      setBinding(null);
      const name = fresh.label || fresh.id;
      toast({ tone: 'ok', message: value === null ? t('diagrams.frames.unbound', { frame: name }) : t('diagrams.frames.bound', { frame: name }) });
    });
  };

  const menu: BarAction[] = [
    { key: 'cabinet', label: t('diagrams.frames.cabinetButton'), disabled: !ready, onSelect: () => setCabinetOpen(true) },
    { key: 'bind', label: t('diagrams.frames.bindButton'), disabled: !ready, onSelect: openBind },
  ];
  const popovers = (
    <BarPopover title={t('diagrams.frames.cabinetTitle')} open={cabinetOpen} onOpenChange={setCabinetOpen}>
      <CabinetPicker present={present} busy={inserting} onInsert={(id, code) => void insertCabinet(id, code)} />
    </BarPopover>
  );

  const dialogs = binding ? <FrameBindDialog diagramId={diagramId} frames={binding} onBind={bind} onClose={() => setBinding(null)} /> : null;

  return { menu, popovers, dialogs };
}
