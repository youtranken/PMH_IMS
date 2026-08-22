import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { FilePicker } from '@/ui/file-picker';
import { ImportPreview, type ImportPreviewRow, type ImportPreviewSummary } from '@/ui/import-preview';
import { useToast } from '@/ui/toast';
import type { CatalogEntity } from './catalog-types';

interface ApiImportRow {
  sheet: CatalogEntity;
  rowNumber: number;
  action: ImportPreviewRow['action'];
  label: string;
  message?: string;
}

interface ApiImportPlan {
  rows: ApiImportRow[];
  summary: ImportPreviewSummary;
}

interface ApiImportResult {
  plan: ApiImportPlan;
  created: number;
  updated: number;
}

const SHEET_LABEL: Record<CatalogEntity, string> = {
  site: 'Site',
  cabinet: 'Tủ mạng',
  device_type: 'Loại thiết bị',
  vendor: 'Nhà cung cấp',
};

/**
 * Nhập danh mục từ Excel — HAI BƯỚC (AC 2.1): đối chiếu trước, ghi sau.
 *
 * Bước ghi gửi LẠI chính file đó lên `/import/commit`; server tính lại bảng đối chiếu rồi
 * mới ghi trong một transaction. Không giữ plan ở server giữa hai bước nên không có chuyện
 * "duyệt một đằng, ghi một nẻo" vì plan cũ hết hạn hay lẫn của người khác.
 */
export function CatalogImportDialog({
  csrfToken,
  onClose,
  onImported,
}: {
  csrfToken: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ApiImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (step: 'preview' | 'commit') => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (step === 'preview') {
        setPlan(await uploadFile<ApiImportPlan>('/api/v1/catalog/import/preview', file, csrfToken));
      } else {
        const result = await uploadFile<ApiImportResult>(
          '/api/v1/catalog/import/commit',
          file,
          csrfToken,
        );
        toast({
          message: t('catalog.importDone', {
            created: result.created,
            updated: result.updated,
          }),
        });
        onImported();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rows: ImportPreviewRow[] =
    plan?.rows.map((row) => ({
      group: SHEET_LABEL[row.sheet],
      rowNumber: row.rowNumber,
      action: row.action,
      label: row.label,
      message: row.message,
    })) ?? [];

  const writable = plan ? plan.summary.create + plan.summary.update : 0;
  const hasErrors = (plan?.summary.error ?? 0) > 0;

  return (
    <Dialog open onOpenChange={busy ? () => undefined : onClose} dismissible={!busy} maxWidth={900}>
      <DialogTitle>{t('catalog.importTitle')}</DialogTitle>

      <FilePicker
        accept=".xlsx"
        label={t('catalog.importPick')}
        hint={t('catalog.importHint')}
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
              {t('catalog.importHasErrors')}
            </p>
          ) : writable === 0 ? (
            <p className="muted">{t('catalog.importNothing')}</p>
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
          {busy && !plan ? t('common.loading') : t('catalog.importCheck')}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!plan || hasErrors || writable === 0 || busy}
          onClick={() => void run('commit')}
        >
          {t('catalog.importConfirm')}
        </button>
      </div>
    </Dialog>
  );
}
