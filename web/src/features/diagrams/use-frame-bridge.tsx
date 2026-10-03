import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import { Popover } from '@/ui/popover';
import { useToast } from '@/ui/toast';
import { CabinetPicker } from './cabinet-picker';
import { insertPatch, lastChildId, layerIdOf, nextInsertPosition, pageIds, type Bounds } from './drawio-bridge';
import { FrameBindDialog } from './frame-bind-dialog';
import { bindFrameValue, cabinetFrameCells, cabinetIdsInXml, frameCandidates, type CabinetFrameLayout, type FrameCandidate } from './frame-bridge';

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
}): { actions: ReactNode; dialogs: ReactNode } {
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
        const cells = cabinetFrameCells(frame.layout, { parent, previous: lastChildId(file, pageId, parent), ...at, newId });
        send({ action: 'patch', patch: insertPatch(pageId, cells) });
        const right = Math.max(...frame.layout.frames.map((f) => f.x + f.width));
        const bottom = Math.max(...frame.layout.frames.map((f) => f.y + f.height));
        bounds.grow({ ...at, width: right, height: bottom });
        setJustInserted((current) => ({ xml, ids: current.xml === xml ? [...current.ids, cabinetId] : [cabinetId] }));
        markDirty();
        setCabinetOpen(false);
        onInserted(frame.layout.devices.map((d) => d.id));
        toast({ tone: 'ok', message: t('diagrams.frames.cabinetInserted', { code, count: frame.layout.devices.length }) });
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

  const actions = (
    <>
      <Popover label={t('diagrams.frames.cabinetButton')} title={t('diagrams.frames.cabinetTitle')} open={cabinetOpen} onOpenChange={setCabinetOpen} disabled={!ready}>
        <CabinetPicker present={present} busy={inserting} onInsert={(id, code) => void insertCabinet(id, code)} />
      </Popover>
      <button type="button" className="btn" disabled={!ready} onClick={openBind}>
        {t('diagrams.frames.bindButton')}
      </button>
    </>
  );

  const dialogs = binding ? <FrameBindDialog diagramId={diagramId} frames={binding} onBind={bind} onClose={() => setBinding(null)} /> : null;

  return { actions, dialogs };
}
