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
 * Hộp "Nhập từ Excel" của một màn hồ sơ có đủ bốn route chuẩn dưới `base` (UX-E30):
 * `template`, `import/preview`, `import/errors`, `import/commit` — Tài khoản dịch vụ, Đường truyền,
 * Phần mềm. Chỉ là `ImportDialog` dùng chung điền sẵn đường dẫn, không luồng riêng.
 */
export function ExcelImportDialog({
  base,
  title,
  hint,
  group,
  fileStem,
  templateLabel,
  csrfToken,
  onClose,
  onImported,
}: {
  /** Ví dụ `/api/v1/service-accounts`. */
  base: string;
  title: string;
  hint: string;
  /** Tên nhóm trên bảng đối chiếu (tên màn). */
  group: string;
  /** Gốc tên file: `mau-<stem>.xlsx`, `dong-loi-<stem>.xlsx`. */
  fileStem: string;
  templateLabel: string;
  csrfToken: string;
  onClose: () => void;
  onImported: () => void;
}) {
  return (
    <ImportDialog<ApiImportRow>
      title={title}
      hint={hint}
      previewUrl={`${base}/import/preview`}
      commitUrl={`${base}/import/commit`}
      errorsUrl={`${base}/import/errors`}
      errorsFileName={`dong-loi-${fileStem}.xlsx`}
      csrfToken={csrfToken}
      mapRow={(row) => ({ group, rowNumber: row.rowNumber, action: row.action, label: row.label, message: row.message })}
      onClose={onClose}
      onImported={onImported}
      template={<ExportXlsxButton url={`${base}/template`} fileName={`mau-${fileStem}.xlsx`} label={templateLabel} link />}
    />
  );
}
