import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { PATHS } from '@/lib/routes';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { useDisabledReason } from '@/ui/disabled-reason';
import type { DrawioCommand } from '@/ui/drawio-protocol';
import type { BarAction } from './diagram-bar';
import { pageIds } from './drawio-bridge';
import { currentChoice, deviceCellsOnPage, photoCellUpdate, photoChoiceReason, type DeviceCellOnPage, type DeviceLook, type PhotoChoice } from './photo-bridge';

interface LooksResponse {
  imsStyleKeys: string[];
  /** Chỗ đặt nhãn của máy trong khung tủ (server) — vắng ở server cũ. */
  rackLabelStyle?: string;
  items: DeviceLook[];
}

/** Trần số máy một lần hỏi `device-looks` — trùng `DEVICE_LOOKS_MAX_IDS` của api; đổi thì đổi cả hai. */
export const DEVICE_LOOKS_BATCH = 40;

const CHOICES: PhotoChoice[] = ['icon', 'front', 'back'];
const CHOICE_KEY: Record<PhotoChoice, string> = { icon: 'diagrams.photo.icon', front: 'diagrams.photo.front', back: 'diagrams.photo.back' };

/** Ảnh (data URI đã thu nhỏ của server) nằm trong style ô ảnh — dùng làm ảnh xem trước trong hộp. */
function imageOfStyle(style: string): string | null {
  const match = /(?:^|;)image=([^;]+)/.exec(style);
  return match && match[1].startsWith('data:image/') ? match[1] : null;
}

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
      const batches: string[][] = [];
      for (let i = 0; i < ids.length; i += DEVICE_LOOKS_BATCH) batches.push(ids.slice(i, i + DEVICE_LOOKS_BATCH));
      // Tuần tự từng lô: mỗi lô đã bắt server đọc + thu nhỏ tới 2 ảnh mỗi máy.
      batches
        .reduce<Promise<LooksResponse>>(
          (acc, batch) =>
            acc.then(async (sofar) => {
              const res = await apiFetch<LooksResponse>(`/api/v1/diagrams/device-looks?ids=${batch.join(',')}`);
              return { imsStyleKeys: res.imsStyleKeys, rackLabelStyle: res.rackLabelStyle, items: [...sofar.items, ...res.items] };
            }),
          Promise.resolve({ imsStyleKeys: [], items: [] }),
        )
        .then(setLooks)
        .catch((err: unknown) => setError(errorMessage(err)));
    });
  };

  const choose = (cell: DeviceCellOnPage, choice: PhotoChoice) => {
    if (!state || !looks) return;
    const look = looks.items.find((l) => l.id === cell.deviceId);
    if (!look || photoChoiceReason(look, choice)) return;
    const update = photoCellUpdate(cell, look, choice, looks.imsStyleKeys, looks.rackLabelStyle);
    send({
      action: 'patch',
      patch: { u: { [state.pageId]: { cells: { u: { [cell.id]: update } } } } },
    });
    markDirty();
    /*
     * Đánh dấu lựa chọn mới ngay: lượt đọc lại tệp đi vòng qua draw.io (postMessage), chờ nó thì
     * nút radio vừa bấm trông như không ăn. Lượt đọc vẫn chạy để lần đổi kế tiếp của cùng ô dựa
     * trên đúng style draw.io đang giữ.
     */
    const photo = choice === 'icon' ? null : choice;
    setState({ ...state, cells: state.cells.map((c) => (c.id === cell.id ? { ...c, photo, style: update.style } : c)) });
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
  // Máy thiếu ảnh một mặt: lối sang trang thiết bị để tải (tab mới — rời màn sửa là mất nét đang vẽ).
  const missingSide = look?.found && (!look.front || !look.back);
  return (
    <tr>
      <td>
        <span className="mono">{cell.code}</span>
        {missingSide ? (
          <>
            <br />
            <a className="small" href={PATHS.device(cell.deviceId)} target="_blank" rel="noopener noreferrer">
              {t('diagrams.photo.addPhoto', { code: cell.code })}
            </a>
          </>
        ) : null}
      </td>
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
                {choice !== 'icon' && look?.[choice] && imageOfStyle(look[choice].style) ? (
                  <img
                    className="photo-thumb"
                    src={imageOfStyle(look[choice].style) ?? ''}
                    alt={t('diagrams.photo.thumbOf', { side: t(CHOICE_KEY[choice]), code: cell.code })}
                  />
                ) : null}
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
