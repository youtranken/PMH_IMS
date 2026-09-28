import { useTranslation } from 'react-i18next';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { ImportDialog } from '@/ui/import-dialog';
import type { ImportPreviewChange, ImportPreviewRow } from '@/ui/import-preview';
import type { IMPORTABLE_ENTITIES } from '@/lib/catalog-types';

/** Chỉ bốn danh mục gốc có sheet trong file mẫu — khớp `IMPORTABLE_ENTITIES` phía API. */
type ImportableEntity = (typeof IMPORTABLE_ENTITIES)[number];

interface ApiImportRow {
  sheet: ImportableEntity;
  rowNumber: number;
  action: ImportPreviewRow['action'];
  label: string;
  message?: string;
  changes?: ImportPreviewChange[];
}

/** Tên sheet = tên tab của chính màn Danh mục — cùng một khóa, không thể lệch nhau. */
const SHEET_LABEL_KEY: Record<ImportableEntity, string> = {
  site: 'catalog.tabSite',
  cabinet: 'catalog.tabCabinet',
  device_type: 'catalog.tabDeviceType',
  vendor: 'catalog.tabVendor',
};

/**
 * Nhập danh mục từ Excel (story 2.1) — chỉ là `ImportDialog` dùng chung (AD-15) cắm vào
 * endpoint của danh mục. Phần "một dòng hiển thị thế nào" là thứ duy nhất riêng ở đây:
 * dòng danh mục cần cho biết nó thuộc sheet nào.
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
  return (
    <ImportDialog<ApiImportRow>
      title={t('catalog.importTitle')}
      hint={t('catalog.importHint')}
      previewUrl="/api/v1/catalog/import/preview"
      commitUrl="/api/v1/catalog/import/commit"
      csrfToken={csrfToken}
      /* File mẫu nằm NGAY trong hộp: nó là bước con của việc nhập, và file đó đã kèm danh mục
         đang có — sửa rồi nhập lại là cách xuất/nhập danh mục. */
      template={
        <ExportXlsxButton
          url="/api/v1/catalog/template"
          fileName="mau-danh-muc.xlsx"
          label={t('catalog.downloadTemplate')}
        />
      }
      mapRow={(row) => ({
        group: t(SHEET_LABEL_KEY[row.sheet]),
        rowNumber: row.rowNumber,
        action: row.action,
        label: row.label,
        message: row.message,
        changes: row.changes,
      })}
      onClose={onClose}
      onImported={onImported}
    />
  );
}
