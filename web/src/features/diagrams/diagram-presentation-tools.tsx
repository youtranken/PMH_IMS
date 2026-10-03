import { useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { TREE_KEY, type DiagramNode } from './diagram-api';
import type { BarAction } from './diagram-bar';
import {
  fitImageSize,
  imageCellSpec,
  imageDataUrlReason,
  newerOfficialSeq,
  plannedCellSpec,
  sniffImageMime,
  type FreeCellSpec,
} from './diagram-presentation';

type Run = <T>(action: () => Promise<T>, purpose: string) => Promise<T>;

/** Cạnh dài nhất của ảnh tự do lúc mới chèn — người vẽ kéo to/nhỏ sau trong trình vẽ. */
const IMAGE_BOX = 320;

/**
 * Dải "BẢN TRÌNH BÀY — không phải sơ đồ chính thức" ngay trên trình xem/trình vẽ (Q-23, FR-045):
 * ai mở, chụp màn hình hay in trang đều thấy đây không phải sơ đồ chính thức. File xuất ghép cùng
 * câu từ `presentationBand` phía server.
 */
export function PresentationBand({ diagram }: { diagram: DiagramNode }) {
  const { t } = useTranslation();
  if (diagram.kind !== 'presentation') return null;
  const source = diagram.source ?? null;
  const newer = newerOfficialSeq(source);
  return (
    <div className="alert warn full-band" role="note" aria-label={t('diagrams.presentation.band')}>
      <strong>{t('diagrams.presentation.band')}</strong>
      {source?.seq ? <span> · {t('diagrams.presentation.basedOn', { seq: source.seq })}</span> : null}
      {newer && source?.diagramId ? (
        <span>
          {' · '}
          <strong>{t('diagrams.presentation.newer', { seq: newer })}</strong>{' '}
          <Link to={PATHS.diagram(source.diagramId)}>{t('diagrams.presentation.openSource')}</Link>
        </span>
      ) : null}
    </div>
  );
}

/** "Tạo bản trình bày" chỉ có nghĩa trên bản đã có bản chính thức — mọi vai. */
export function canCreatePresentation(diagram: DiagramNode | undefined): boolean {
  return Boolean(diagram && diagram.kind === 'official' && diagram.officialSeq);
}

/**
 * Hộp "Tạo bản trình bày" (mở từ menu ⋮ của thanh). Lời gọi đi qua `run` vì nó chép nội dung bản
 * chính thức (đòi mã phạm vi sơ đồ như khi xem).
 */
export function CreatePresentationDialog({ me, diagram, run, onClose }: { me: Me; diagram: DiagramNode; run: Run; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const body = JSON.stringify(name.trim() ? { name: name.trim() } : {});
      const created = await run(
        () => apiFetch<DiagramNode>(`/api/v1/diagrams/${diagram.id}/presentations`, { method: 'POST', csrfToken: me.csrfToken, body }),
        t('diagrams.presentation.stepUp', { name: diagram.name }),
      );
      void queryClient.invalidateQueries({ queryKey: TREE_KEY });
      toast({ tone: 'ok', message: t('diagrams.presentation.created', { name: created.name }) });
      onClose();
      navigate(PATHS.diagram(created.id));
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      dismissible={!busy}
      maxWidth={520}
      initialFocus="first-field"
      title={t('diagrams.presentation.createTitle', { name: diagram.name })}
      footer={
        <>
          <DialogCancel>{t('diagrams.form.cancel')}</DialogCancel>
          <button type="submit" form="diagram-presentation-form" className="btn primary" disabled={busy}>
            {t('diagrams.presentation.createConfirm')}
          </button>
        </>
      }
    >
      <form
        id="diagram-presentation-form"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <p className="muted">{t('diagrams.presentation.createIntro', { seq: diagram.officialSeq })}</p>
        <Field label={t('diagrams.presentation.name')} hint={t('diagrams.presentation.nameHint', { name: diagram.name })}>
          <input className="inp" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

function readFile(file: File, as: 'buffer' | 'dataUrl'): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer | string);
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    if (as === 'buffer') reader.readAsArrayBuffer(file);
    else reader.readAsDataURL(file);
  });
}

/** Cỡ thật của ảnh; trình duyệt không giải mã được (hoặc quá lâu) thì 0×0 → khung mặc định. */
function naturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    const timer = window.setTimeout(() => resolve({ width: 0, height: 0 }), 1500);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve({ width: 0, height: 0 });
    };
    image.src = dataUrl;
  });
}

/**
 * Việc riêng của bản trình bày trên thanh trên trình vẽ (vào menu ⋮): "Thiết bị dự kiến" (hộp nhập
 * tên, model, giá, NCC) và "Thêm ảnh" (ảnh nhúng vào XML — không đi qua `files`, cổng XML của
 * server chỉ nhận ảnh `data:image/...` và trần cỡ bản vẽ). Dựng ô xong thì trả cho màn sửa chèn
 * bằng `patch`. `elements` (ô chọn file ẩn + hộp) đặt vào cây JSX của màn.
 */
export function usePresentationTools({
  disabled,
  xmlMaxKb,
  onInsert,
}: {
  disabled: boolean;
  xmlMaxKb?: number;
  onInsert: (specs: FreeCellSpec[], message: string) => void;
}): { menu: BarAction[]; elements: ReactNode } {
  const { t } = useTranslation();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [plannedOpen, setPlannedOpen] = useState(false);
  const [form, setForm] = useState({ name: '', model: '', price: '', vendor: '' });
  const [nameError, setNameError] = useState<string | null>(null);

  const insertPlanned = () => {
    if (!form.name.replace(/[<>]/g, '').trim()) {
      setNameError(t('diagrams.presentation.plannedNameRequired'));
      return;
    }
    const spec = plannedCellSpec(form, t('diagrams.presentation.plannedWord'));
    onInsert([spec], t('diagrams.presentation.inserted', { name: form.name.trim() }));
    setPlannedOpen(false);
    setForm({ name: '', model: '', price: '', vendor: '' });
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const head = new Uint8Array((await readFile(file.slice(0, 16) as File, 'buffer')) as ArrayBuffer);
      if (!sniffImageMime(head)) {
        toast({ tone: 'error', message: t('diagrams.presentation.imageWrongType') });
        return;
      }
      const dataUrl = (await readFile(file, 'dataUrl')) as string;
      const tooBig = xmlMaxKb ? imageDataUrlReason(dataUrl, xmlMaxKb) : null;
      if (tooBig) {
        toast({ tone: 'error', message: t('diagrams.presentation.imageTooBig', { max: tooBig }) });
        return;
      }
      const size = await naturalSize(dataUrl);
      onInsert([imageCellSpec(dataUrl, fitImageSize(size.width, size.height, IMAGE_BOX))], t('diagrams.presentation.imageInserted'));
    } catch {
      toast({ tone: 'error', message: t('diagrams.presentation.imageReadFailed') });
    }
  };

  const field = (key: keyof typeof form, label: string, required = false) => (
    <Field label={label} required={required} error={key === 'name' ? nameError : null}>
      <input
        className="inp"
        value={form[key]}
        maxLength={120}
        required={required}
        onChange={(event) => {
          if (key === 'name') setNameError(null);
          setForm({ ...form, [key]: event.target.value });
        }}
      />
    </Field>
  );

  const menu: BarAction[] = [
    { key: 'planned', label: t('diagrams.presentation.planned'), disabled, onSelect: () => setPlannedOpen(true) },
    { key: 'image', label: t('diagrams.presentation.image'), disabled, onSelect: () => fileInput.current?.click() },
  ];
  const elements = (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp"
        aria-label={t('diagrams.presentation.imagePick')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void pickImage(file);
        }}
      />
      {plannedOpen ? (
        <Dialog
          open
          onOpenChange={() => setPlannedOpen(false)}
          guardUnsaved
          maxWidth={520}
          initialFocus="first-field"
          title={t('diagrams.presentation.plannedTitle')}
          footer={
            <>
              <DialogCancel>{t('diagrams.form.cancel')}</DialogCancel>
              <button type="submit" form="diagram-planned-form" className="btn primary">
                {t('diagrams.presentation.plannedInsert')}
              </button>
            </>
          }
        >
          <form
            id="diagram-planned-form"
            className="form-grid"
            data-columns={1}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              insertPlanned();
            }}
          >
            <p className="muted">{t('diagrams.presentation.plannedIntro')}</p>
            {field('name', t('diagrams.presentation.plannedName'), true)}
            {field('model', t('diagrams.presentation.plannedModel'))}
            {field('price', t('diagrams.presentation.plannedPrice'))}
            {field('vendor', t('diagrams.presentation.plannedVendor'))}
          </form>
        </Dialog>
      ) : null}
    </>
  );
  return { menu, elements };
}
