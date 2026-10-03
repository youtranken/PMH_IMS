import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { useDisabledReason } from '@/ui/disabled-reason';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import type { BarAction } from './diagram-bar';
import { pageIds } from './drawio-bridge';
import { currentChoice, deviceCellsOnPage, photoCellUpdate, photoChoiceReason, type DeviceCellOnPage, type DeviceLook, type PhotoChoice } from './photo-bridge';

interface LooksResponse {
  imsStyleKeys: string[];
  items: DeviceLook[];
}

const CHOICES: PhotoChoice[] = ['icon', 'front', 'back'];
const CHOICE_KEY: Record<PhotoChoice, string> = { icon: 'diagrams.photo.icon', front: 'diagrams.photo.front', back: 'diagrams.photo.back' };

/**
 * Công tắc "Biểu tượng / Ảnh thật" của màn sửa (mục ⋮ "Ảnh thật…"): hộp liệt kê ô thiết bị của
 * trang đang mở, mỗi ô một nhóm Biểu tượng / Ảnh mặt trước / Ảnh mặt sau. Đổi là sửa ô bằng `patch`
 * (không `merge`); không có ảnh thì lựa chọn tắt kèm lý do. Ảnh đi vào bản vẽ qua hydrate (AD-18) —
 * lưu bản vẽ chỉ giữ `ims_photo`.
 */
export function usePhotoBridge({
  ready,
  withFile,
  send,
  page,
  markDirty,
}: {
  ready: boolean;
  withFile: (fn: (xml: string) => void) => void;
  send: (command: DrawioCommand) => void;
  page: () => number;
  markDirty: () => void;
}): { menu: BarAction[]; dialogs: ReactNode } {
  const { t } = useTranslation();
  const [state, setState] = useState<{
    pageId: string;
    cells: DeviceCellOnPage[];
  } | null>(null);
  const [looks, setLooks] = useState<LooksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = (then?: (pageId: string, cells: DeviceCellOnPage[]) => void) =>
    withFile((file) => {
      const pages = pageIds(file);
      const pageId = pages[Math.min(page(), pages.length - 1)];
      if (!pageId) return;
      const cells = deviceCellsOnPage(file, pageId);
      setState({ pageId, cells });
      then?.(pageId, cells);
    });

  const open = () => {
    setError(null);
    setLooks(null);
    read((_pageId, cells) => {
      const ids = [...new Set(cells.map((c) => c.deviceId))];
      if (ids.length === 0) {
        setLooks({ imsStyleKeys: [], items: [] });
        return;
      }
      apiFetch<LooksResponse>(`/api/v1/diagrams/device-looks?ids=${ids.join(',')}`)
        .then(setLooks)
        .catch((err: unknown) => setError(errorMessage(err)));
    });
  };

  const choose = (cell: DeviceCellOnPage, choice: PhotoChoice) => {
    if (!state || !looks) return;
    const look = looks.items.find((l) => l.id === cell.deviceId);
    if (!look || photoChoiceReason(look, choice)) return;
    const update = photoCellUpdate(cell, look, choice, looks.imsStyleKeys);
    send({
      action: 'patch',
      patch: { u: { [state.pageId]: { cells: { u: { [cell.id]: update } } } } },
    });
    markDirty();
    // Đọc lại tệp: lượt đổi kế tiếp của cùng ô phải dựa trên style vừa đặt.
    read();
  };

  const menu: BarAction[] = [
    {
      key: 'photos',
      label: t('diagrams.photo.menuButton'),
      disabled: !ready,
      onSelect: open,
    },
  ];
  const dialogs = state ? (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) setState(null);
      }}
      maxWidth={640}
      title={t('diagrams.photo.title')}
      footer={<DialogCancel>{t('common.close')}</DialogCancel>}
    >
      <p className="muted">{t('diagrams.photo.hint')}</p>
      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : !looks ? (
        <p className="muted">{t('common.loading')}</p>
      ) : state.cells.length === 0 ? (
        <p className="muted">{t('diagrams.photo.empty')}</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{t('diagrams.photo.device')}</th>
              <th>{t('diagrams.photo.look')}</th>
            </tr>
          </thead>
          <tbody>
            {state.cells.map((cell) => (
              <PhotoRow key={cell.id} cell={cell} look={looks.items.find((l) => l.id === cell.deviceId)} onChoose={(choice) => choose(cell, choice)} />
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  ) : null;

  return { menu, dialogs };
}

function PhotoRow({ cell, look, onChoose }: { cell: DeviceCellOnPage; look: DeviceLook | undefined; onChoose: (choice: PhotoChoice) => void }) {
  const { t } = useTranslation();
  const reasonText = (choice: PhotoChoice) => {
    const reason = photoChoiceReason(look, choice);
    if (reason === 'missing') return t('diagrams.photo.missing');
    if (reason === 'noPhoto') return t(choice === 'front' ? 'diagrams.photo.noFront' : 'diagrams.photo.noBack');
    return null;
  };
  const front = useDisabledReason(reasonText('front'));
  const back = useDisabledReason(reasonText('back'));
  const reasons: Record<PhotoChoice, ReturnType<typeof useDisabledReason> | null> = { icon: null, front, back };
  const chosen = currentChoice(cell);
  return (
    <tr>
      <td className="mono">{cell.code}</td>
      <td>
        <div className="segmented" role="radiogroup" aria-label={t('diagrams.photo.choiceOf', { code: cell.code })}>
          {CHOICES.map((choice) => {
            const reason = reasons[choice];
            const disabled = Boolean(reason?.hint);
            return (
              <label key={choice} {...(reason?.buttonProps ?? {})}>
                <input
                  type="radio"
                  name={`photo-${cell.id}`}
                  value={choice}
                  checked={chosen === choice}
                  disabled={disabled}
                  onChange={() => onChoose(choice)}
                />
                {t(CHOICE_KEY[choice])}
                {reason?.hint}
              </label>
            );
          })}
        </div>
      </td>
    </tr>
  );
}
