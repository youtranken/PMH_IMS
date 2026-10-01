import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFile } from '@/lib/download-file';
import { RowActions } from '@/ui/row-actions';
import { useToast } from '@/ui/toast';

/**
 * Tải file xlsx từ API export + báo lỗi bằng toast. Tách ra để màn hẹp đặt "Xuất Excel" vào menu
 * ⋮ đầu trang (`RowActions`) mà không chép lại logic tải — vẫn là MỘT đường xuất (FR-028).
 */
export function useXlsxDownload(): { busy: boolean; run: (url: string, fileName: string) => void } {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = (target: string, name: string) => {
    setBusy(true);
    void downloadFile(target, name)
      .catch(() => toast({ message: t('common.error'), tone: 'error' }))
      .finally(() => setBusy(false));
  };
  return { busy, run };
}

/**
 * FR-028: xuất xlsx từ MỌI bảng đang xem — AD-15 nên chỉ có MỘT nút này.
 * Nơi gọi truyền đường dẫn API export của module chủ (server dựng file bằng
 * ExcelExportService dùng chung), UI không tự sinh file.
 *
 * `allUrl`: màn nào có cả "phần đang xem" lẫn "tất cả" (màn IP: một dải / mọi dải, Q-20) thì
 * nút thành menu nhỏ hai mục. Một menu chứ không phải hai nút cạnh nhau: đầu trang đã chật, và
 * hai nút "Xuất" đứng sát nhau thì người ta không biết nút nào ra file nào.
 */
export function ExportXlsxButton({
  url,
  fileName,
  label,
  disabled,
  currentLabel,
  allUrl,
  allFileName,
  allLabel,
}: {
  /** Ví dụ: `/api/v1/devices/export?site=HN`. Giữ nguyên query của bộ lọc đang xem. */
  url: string;
  fileName: string;
  label?: string;
  disabled?: boolean;
  /** Chỉ khi có `allUrl`: chữ của mục "phần đang xem" (mặc định "Xuất bảng đang xem"). */
  currentLabel?: string;
  allUrl?: string;
  allFileName?: string;
  /** Chữ của mục "tất cả" (mặc định "Xuất tất cả"). */
  allLabel?: string;
}) {
  const { t } = useTranslation();
  const { busy, run } = useXlsxDownload();
  const text = label ?? t('common.export');

  if (allUrl) {
    return (
      <RowActions
        label={text}
        triggerText={busy ? t('common.loading') : text}
        items={[
          {
            key: 'current',
            label: currentLabel ?? t('common.exportCurrent'),
            disabled: disabled || busy,
            onSelect: () => run(url, fileName),
          },
          {
            key: 'all',
            label: allLabel ?? t('common.exportAll'),
            disabled: busy,
            onSelect: () => run(allUrl, allFileName ?? 'tat-ca.xlsx'),
          },
        ]}
      />
    );
  }

  return (
    <button
      type="button"
      className="btn"
      disabled={disabled || busy}
      onClick={() => run(url, fileName)}
    >
      {busy ? t('common.loading') : text}
    </button>
  );
}
