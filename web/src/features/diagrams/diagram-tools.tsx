import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { postForDownload } from '@/lib/download-file';
import type { Me } from '@/lib/me';
import { useToast } from '@/ui/toast';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { BarPopover } from './diagram-bar';
import type { DiagramNode } from './diagram-api';

type Run = <T>(action: () => Promise<T>, purpose: string) => Promise<T>;

/**
 * "Xuất" (mục menu ⋮ của thanh mảnh): PNG/PDF của phiên bản ĐANG XEM, server dựng từ ảnh đã lưu kèm chân trang
 * và watermark người xuất (FR-044). Đòi mã phạm vi sơ đồ — hết ân hạn thì hỏi mã tại chỗ; huỷ thì
 * không có file, không có dòng nhật ký.
 */
export function ExportMenu({
  me,
  diagram,
  versionId,
  run,
  open,
  onOpenChange: setOpen,
}: {
  me: Me;
  diagram: DiagramNode;
  versionId: string;
  run: Run;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const exportAs = async (format: 'png' | 'pdf') => {
    setBusy(true);
    try {
      await run(
        () => postForDownload(`/api/v1/diagrams/${diagram.id}/versions/${versionId}/exports`, { format }, me.csrfToken, `${diagram.name}.${format}`),
        t('diagrams.tools.stepUpExport', { name: diagram.name }),
      );
      setOpen(false);
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <BarPopover title={t('diagrams.tools.exportTitle')} open={open} onOpenChange={setOpen}>
      <p className="muted">{t('diagrams.tools.exportHint')}</p>
      <p className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void exportAs('png')}>
          {t('diagrams.tools.exportPng')}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void exportAs('pdf')}>
          {t('diagrams.tools.exportPdf')}
        </button>
      </p>
    </BarPopover>
  );
}

