import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFile } from '@/lib/download-file';
import { useToast } from '@/ui/toast';

/**
 * FR-028: xuất xlsx từ MỌI bảng đang xem — AD-15 nên chỉ có MỘT nút này.
 * Nơi gọi truyền đường dẫn API export của module chủ (server dựng file bằng
 * ExcelExportService dùng chung), UI không tự sinh file.
 */
export function ExportXlsxButton({
  url,
  fileName,
  label,
  disabled,
}: {
  /** Ví dụ: `/api/v1/devices/export?site=HN`. Giữ nguyên query của bộ lọc đang xem. */
  url: string;
  fileName: string;
  label?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="btn"
      disabled={disabled || busy}
      onClick={() => {
        setBusy(true);
        void downloadFile(url, fileName)
          .catch(() => toast({ message: t('common.error'), tone: 'error' }))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? t('common.loading') : (label ?? t('common.export'))}
    </button>
  );
}
