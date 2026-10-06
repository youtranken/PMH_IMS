import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { nearestFreeU, rackClash, rackUnitLabel } from '@/lib/rack-units';
import { Dialog } from '@/ui/dialog';
import { NumberStepper } from '@/ui/number-stepper';
import { Field } from '@/ui/page-header';
import { RackElevation } from '@/ui/rack-elevation';
import { useCabinetOccupants } from '@/ui/use-cabinet-occupants';
import { useCatalogLists } from '@/ui/use-catalog-lists';
import { useToast } from '@/ui/toast';
import type { RackMismatch } from './rack-fit';

/** Máy vừa được ghi sang tủ mới — màn cập nhật thông tin kho đang giữ rồi đặt lại ô theo U. */
export interface RackMoved {
  deviceId: string;
  cabinetId: string;
  cabinetCode: string;
  u: number;
  uSize: number;
}

/** Lỗi chỗ U của `devices` — gắn vào ô U như form thiết bị, không thành lời báo chung. */
const RACK_ERRORS = new Set(['DEVICE_RACK_U_TAKEN', 'DEVICE_RACK_U_INVALID', 'CABINET_SITE_MISMATCH']);

/**
 * Hộp "Chuyển máy sang tủ này?" (Q-23 06/10): máy kho ghi tủ khác (hay chưa gắn tủ) mà nằm trong
 * khung tủ trên bản vẽ. Không ghi gì trước khi người vẽ bấm "Chuyển máy"; bấm thì gọi đúng API sửa
 * thiết bị của `devices` (AD-3: sơ đồ không ghi bảng `device`) — cùng quyền, cùng lịch sử thiết bị
 * như sửa ở trang thiết bị. U đề xuất = U nơi thả, chiếm rồi thì U trống gần nhất; kiểm chồng U
 * tại ô như form thiết bị, server vẫn là trọng tài.
 *
 * `kind="declare"` (Q-23 06/10 D): máy CÙNG tủ nhưng kho chưa khai U vừa được kéo vào khung — cùng
 * hộp, cùng đường ghi, chỉ khác lời: "Khai U cho máy này?".
 */
export function RackMoveDialog({
  item,
  csrfToken,
  revert,
  kind = 'move',
  onMoved,
  onClose,
}: {
  item: RackMismatch;
  csrfToken: string;
  /** Ô vừa được kéo vào khung: Huỷ đưa ô ra khỏi khung (nút ghi rõ). */
  revert: boolean;
  kind?: 'move' | 'declare';
  onMoved: (moved: RackMoved) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const lists = useCatalogLists();
  const occupants = useCabinetOccupants(item.frameCabinetId);
  const target = (lists.data?.cabinets ?? []).find((c) => c.id === item.frameCabinetId) ?? null;
  const height = target?.uHeight ?? item.rackU;
  const others = occupants.data ?? [];
  const suggested = occupants.isSuccess ? nearestFreeU(item.dropU ?? 1, item.uSize, height, others, item.deviceId) : null;
  // `null` = người vẽ chưa gõ: theo U đề xuất (đọc xong danh sách máy của tủ mới có).
  const [typed, setTyped] = useState<string | null>(null);
  const [rackOpen, setRackOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const value = typed ?? (suggested !== null ? String(suggested) : '');
  const u = Number(value.trim());
  const valid = value.trim() !== '' && Number.isInteger(u) && u >= 1 && u + item.uSize - 1 <= height;
  const clash = valid ? rackClash({ start: u, size: item.uSize }, others, item.deviceId) : null;
  const full = occupants.isSuccess && suggested === null;
  const to = target?.code ?? item.frameLabel;
  const declare = kind === 'declare';
  const from = item.deviceCabinet ?? t('diagrams.rack.noCabinet');
  const fieldError =
    serverError ??
    (clash
      ? t('devices.rackTaken', { unit: rackUnitLabel(u, item.uSize), code: clash.code })
      : value.trim() !== '' && !valid
        ? t('diagrams.rack.moveUInvalid', { max: Math.max(height - item.uSize + 1, 1) })
        : null);

  const move = async () => {
    if (!target || !valid || clash) return;
    setBusy(true);
    setServerError(null);
    try {
      await apiFetch(`/api/v1/devices/${item.deviceId}`, {
        method: 'PATCH',
        csrfToken,
        body: JSON.stringify({ siteId: target.siteId, cabinetId: target.id, rackUStart: u, rackUSize: item.uSize }),
      });
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast({ tone: 'ok', message: t(declare ? 'diagrams.rack.declared' : 'diagrams.rack.moved', { code: item.code, to: target.code, unit: rackUnitLabel(u, item.uSize) }) });
      onMoved({ deviceId: item.deviceId, cabinetId: target.id, cabinetCode: target.code, u, uSize: item.uSize });
    } catch (error) {
      if (RACK_ERRORS.has(errorCode(error) ?? '')) setServerError(errorMessage(error));
      else toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <button type="button" className="btn" disabled={busy} onClick={onClose}>
        {declare ? t('diagrams.rack.declareCancel') : revert ? t('diagrams.rack.moveCancelRevert') : t('diagrams.rack.moveCancel')}
      </button>
      <button type="button" className="btn primary" disabled={busy || !target || !valid || Boolean(clash) || full} onClick={() => void move()}>
        {t(declare ? 'diagrams.rack.declareConfirm' : 'diagrams.rack.moveConfirm')}
      </button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()} title={t(declare ? 'diagrams.rack.declareTitle' : 'diagrams.rack.moveTitle')} maxWidth={460} initialFocus="first-field" footer={footer}>
      <p role="status">{t(declare ? 'diagrams.rack.declareSummary' : 'diagrams.rack.moveSummary', { code: item.code, from, to, u: valid ? u : '?', size: item.uSize })}</p>
      <p className="muted small">
        {declare ? t('diagrams.rack.declareHint', { code: item.code }) : <>{t('diagrams.rack.moveHint')} {revert ? t('diagrams.rack.moveHintRevert') : null}</>}
      </p>
      {full ? (
        <p className="alert warn" role="alert">
          {t('diagrams.rack.moveFull', { to, size: item.uSize })}
        </p>
      ) : null}
      <div className="form-grid">
        <Field label={t('diagrams.rack.moveU')} htmlFor="rack-move-u" error={fieldError}>
          <NumberStepper
            id="rack-move-u"
            label={t('diagrams.rack.moveUNoun')}
            min={1}
            max={Math.max(height - item.uSize + 1, 1)}
            value={value}
            disabled={busy}
            onChange={(next) => {
              setTyped(next);
              setServerError(null);
            }}
          />
        </Field>
        <div className="field rack-view-cell">
          <button type="button" className="btn" aria-expanded={rackOpen} onClick={() => setRackOpen((open) => !open)}>
            {t('diagrams.rack.moveViewRack', { to })}
          </button>
        </div>
      </div>
      {rackOpen ? (
        <RackElevation
          label={to}
          height={height}
          occupants={others}
          selfId={item.deviceId}
          onPick={(picked) => {
            setTyped(String(picked));
            setServerError(null);
            setRackOpen(false);
          }}
        />
      ) : null}
    </Dialog>
  );
}

/**
 * Danh sách máy đang nằm trong khung tủ khác tủ trong kho — mục "Chuyển máy sang tủ…" của menu và
 * nút trên lời báo khi có nhiều máy. Chọn một máy là mở hộp chuyển của máy đó.
 */
export function RackMoveListDialog({ items, onPick, onClose }: { items: RackMismatch[]; onPick: (item: RackMismatch) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('diagrams.rack.moveListTitle')} maxWidth={520} initialFocus="title">
      {items.length === 0 ? (
        <p className="alert info" role="status">
          {t('diagrams.rack.moveListEmpty')}
        </p>
      ) : (
        <>
          <p className="muted small">{t('diagrams.rack.moveListHint')}</p>
          <ul className="pick-list">
            {items.map((item) => (
              <li key={item.cellId} className="row" style={{ justifyContent: 'space-between' }}>
                <span>{t('diagrams.rack.moveListRow', { code: item.code, from: item.deviceCabinet ?? t('diagrams.rack.noCabinet'), frame: item.frameLabel })}</span>
                <button type="button" className="btn sm" aria-label={`${t('diagrams.rack.moveAction')} — ${item.code}`} onClick={() => onPick(item)}>
                  {t('diagrams.rack.moveAction')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
