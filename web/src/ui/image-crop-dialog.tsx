import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  lockedCrop,
  loadCropSource,
  moveCrop,
  rackFaceAspect,
  renderCrop,
  resizeCrop,
  type CropBox,
  type CropCorner,
  type CropSource,
} from '@/lib/image-crop';
import { Dialog } from '@/ui/dialog';

const CORNERS: CropCorner[] = ['nw', 'ne', 'sw', 'se'];
/** Một lần bấm phím mũi tên dời khung bằng chừng này phần cạnh ảnh. */
const KEY_STEP = 0.01;

/**
 * Hộp cắt ảnh thiết bị (Q-23 mục A; AD-15 — mọi chỗ tải ảnh thiết bị dùng chung):
 * viền trong suốt / trắng tự bỏ trước, khung khoá theo mặt tủ 19" khi máy có Số U (`units`), không
 * thì cắt tự do. Kéo khung để dời, kéo góc để đổi cỡ; phím mũi tên dời, Shift + mũi tên đổi cỡ.
 * Hộp KHÔNG tự tải lên: trả tệp đã cắt cho nơi gọi, nơi gọi đi đúng đường giấy tờ như trước
 * (server vẫn kiểm loại, cỡ và vẽ lại ảnh).
 */
export function ImageCropDialog({
  file,
  units,
  onCancel,
  onDone,
}: {
  file: File;
  /** Số U của máy; `null`/0 = không khoá tỉ lệ. */
  units: number | null;
  onCancel: () => void;
  onDone: (file: File) => void;
}) {
  const { t } = useTranslation();
  const aspect = rackFaceAspect(units);
  const [source, setSource] = useState<CropSource | null>(null);
  const [box, setBox] = useState<CropBox | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ corner: CropCorner | null; startX: number; startY: number; start: CropBox } | null>(null);

  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    loadCropSource(file)
      .then((loaded) => {
        url = loaded.url;
        if (!alive) {
          URL.revokeObjectURL(loaded.url);
          return;
        }
        setSource(loaded);
        setBox(lockedCrop(loaded.content, aspect, loaded.size));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, aspect]);

  /** Điểm ảnh gốc trên mỗi điểm màn hình (ảnh hiện co theo bề rộng hộp). */
  const scale = () => {
    const width = stage.current?.getBoundingClientRect().width ?? 0;
    return source && width > 0 ? source.size.width / width : 1;
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>, corner: CropCorner | null) => {
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = { corner, startX: event.clientX, startY: event.clientY, start: box };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !source) return;
    const k = scale();
    const dx = (event.clientX - d.startX) * k;
    const dy = (event.clientY - d.startY) * k;
    setBox(d.corner ? resizeCrop(d.start, d.corner, dx, dy, aspect, source.size) : moveCrop(d.start, dx, dy, source.size));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!box || !source) return;
    const step = Math.max(1, Math.round(source.size.width * KEY_STEP));
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    setBox(event.shiftKey ? resizeCrop(box, 'se', move[0], move[1], aspect, source.size) : moveCrop(box, move[0], move[1], source.size));
  };

  const finish = async () => {
    if (!source || !box) return;
    setBusy(true);
    try {
      onDone(await renderCrop(source, box, { name: file.name, type: file.type }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const pct = (value: number, of: number) => `${(value / of) * 100}%`;
  const ready = source && box;

  const footer = (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <button type="button" className="btn" disabled={busy} onClick={onCancel}>
        {t('imageCrop.cancel')}
      </button>
      <button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void finish()}>
        {t('imageCrop.confirm')}
      </button>
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()} title={t('imageCrop.title')} maxWidth={720} initialFocus="title" footer={footer}>
      <p className="muted small" role="status">
        {aspect ? t('imageCrop.locked', { units }) : t('imageCrop.free')}
      </p>
      {failed ? (
        <p className="alert error" role="alert">
          {t('imageCrop.failed')}
        </p>
      ) : null}
      {ready ? (
        <>
          <div ref={stage} className="crop-stage" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
            <img className="crop-stage-img" src={source.url} alt={t('imageCrop.imageAlt', { name: file.name })} draggable={false} />
            <div
              className="crop-box"
              role="group"
              tabIndex={0}
              aria-label={t('imageCrop.frameLabel')}
              style={{
                left: pct(box.x, source.size.width),
                top: pct(box.y, source.size.height),
                width: pct(box.width, source.size.width),
                height: pct(box.height, source.size.height),
              }}
              onPointerDown={(event) => onPointerDown(event, null)}
              onKeyDown={onKeyDown}
            >
              {CORNERS.map((corner) => (
                <span key={corner} className={`crop-handle ${corner}`} aria-hidden="true" onPointerDown={(event) => onPointerDown(event, corner)} />
              ))}
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn sm" disabled={busy} onClick={() => setBox(lockedCrop(source.content, aspect, source.size))}>
              {t('imageCrop.autoTrim')}
            </button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => setBox(lockedCrop({ x: 0, y: 0, ...source.size }, aspect, source.size))}>
              {t('imageCrop.whole')}
            </button>
          </div>
          <p className="muted small">{t('imageCrop.hint')}</p>
        </>
      ) : !failed ? (
        <p className="muted">{t('imageCrop.loading')}</p>
      ) : null}
    </Dialog>
  );
}
