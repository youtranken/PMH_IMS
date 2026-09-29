import { useTranslation } from 'react-i18next';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { ImportDialog } from '@/ui/import-dialog';
import type { ImportPreviewRow } from '@/ui/import-preview';

interface ApiImportRow {
  rowNumber: number;
  action: ImportPreviewRow['action'];
  label: string;
  message?: string;
}

/**
 * Nhập thiết bị từ Excel (story 2.6) — dùng `ImportDialog` chung (AD-15), chỉ khác endpoint.
 * Cột "Mục" của bảng đối chiếu để trống nhãn nhóm vì file thiết bị chỉ có một sheet.
 */
export function DeviceImportDialog({
  csrfToken,
  onClose,
  onImported,
}: {
  csrfToken: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ImportDialog<ApiImportRow>
      title={t('devices.importTitle')}
      hint={t('devices.importHint')}
      previewUrl="/api/v1/devices/import/preview"
      commitUrl="/api/v1/devices/import/commit"
      errorsUrl="/api/v1/devices/import/errors"
      errorsFileName="dong-loi-thiet-bi.xlsx"
      csrfToken={csrfToken}
      mapRow={(row) => ({
        group: t('devices.title'),
        rowNumber: row.rowNumber,
        action: row.action,
        label: row.label,
        message: row.message,
      })}
      onClose={onClose}
      onImported={onImported}
      template={
        <ExportXlsxButton
          url="/api/v1/devices/template"
          fileName="mau-thiet-bi.xlsx"
          label={t('devices.downloadTemplate')}
        />
      }
    />
  );
}
