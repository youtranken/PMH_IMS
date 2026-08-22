import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { FilePicker } from '@/ui/file-picker';
import {
  ImportPreview,
  type ImportPreviewRow,
  type ImportPreviewSummary,
} from '@/ui/import-preview';
import { useToast } from '@/ui/toast';

interface ImportPlan<TRow> {
  rows: TRow[];
  summary: ImportPreviewSummary;
}

interface ImportResult<TRow> {
  plan: ImportPlan<TRow>;
  created: number;
  updated: number;
}

/**
 * Hộp thoại NHẬP TỪ EXCEL dùng chung (AD-15): đối chiếu trước, ghi sau.
 *
 * Import danh mục (2.1) và import thiết bị (2.6) chạy đúng một luồng, chỉ khác endpoint và
 * cách đặt nhãn cho một dòng. Hai bản riêng thì sẽ có một bản quên mất bước xem trước, hoặc
 * cho bấm "ghi" trong khi bảng đối chiếu đang là của file cũ.
 *
 * Bước ghi gửi LẠI chính file đó lên `commitUrl`; server tính lại bảng đối chiếu rồi mới ghi
 * trong một transaction — không giữ plan ở server nên không có chuyện "duyệt một đằng, ghi
 * một nẻo" vì plan hết hạn hay lẫn của người khác.
 */
export function ImportDialog<TRow>({
  title,
  hint,
  previewUrl,
  commitUrl,
  csrfToken,
  mapRow,
  onClose,
  onImported,
}: {
  title: string;
  hint: string;
  previewUrl: string;
  commitUrl: string;
  csrfToken: string;
  /** Đổi một dòng kết quả của API thành dòng hiển thị của bảng đối chiếu. */
  mapRow: (row: TRow) => ImportPreviewRow;
  onClose: () => void;
  onImported: (result: { created: number; updated: number }) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan<TRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (step: 'preview' | 'commit') => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (step === 'preview') {
        setPlan(await uploadFile<ImportPlan<TRow>>(previewUrl, file, csrfToken));
      } else {
        const result = await uploadFile<ImportResult<TRow>>(commitUrl, file, csrfToken);
        toast({
          message: t('importDialog.done', {
            created: result.created,
            updated: result.updated,
          }),
        });
        onImported(result);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rows = plan?.rows.map(mapRow) ?? [];
  const writable = plan ? plan.summary.create + plan.summary.update : 0;
  const hasErrors = (plan?.summary.error ?? 0) > 0;

  return (
    <Dialog open onOpenChange={busy ? () => undefined : onClose} dismissible={!busy} maxWidth={900}>
      <DialogTitle>{title}</DialogTitle>

      <FilePicker
        accept=".xlsx"
        label={t('importDialog.pick')}
        hint={hint}
        file={file}
        disabled={busy}
        onPick={(picked) => {
          setFile(picked);
          // Đổi file thì bảng đối chiếu cũ KHÔNG còn đúng — xóa ngay, không để người dùng
          // bấm "Xác nhận ghi" trong khi đang nhìn kết quả của file trước.
          setPlan(null);
          setError(null);
        }}
      />

      {error ? (
        <p className="alert error" role="alert">
          {error}
        </p>
      ) : null}

      {plan ? (
        <>
          <ImportPreview rows={rows} summary={plan.summary} />
          {hasErrors ? (
            <p className="alert error" role="alert">
              {t('importDialog.hasErrors')}
            </p>
          ) : writable === 0 ? (
            <p className="muted">{t('importDialog.nothing')}</p>
          ) : null}
        </>
      ) : null}

      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!file || busy}
          onClick={() => void run('preview')}
        >
          {busy && !plan ? t('common.loading') : t('importDialog.check')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!plan || hasErrors || writable === 0 || busy}
          onClick={() => void run('commit')}
        >
          {t('importDialog.confirm')}
        </button>
      </div>
    </Dialog>
  );
}
