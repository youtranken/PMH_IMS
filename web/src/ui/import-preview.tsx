import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Kết quả đối chiếu một dòng file import — khớp `ImportRow` phía API. */
export interface ImportPreviewRow {
  /** Nhóm dòng (sheet/loại) — hiện ở cột đầu. */
  group: string;
  rowNumber: number;
  action: 'create' | 'update' | 'unchanged' | 'skip' | 'error';
  label: string;
  message?: string;
}

export interface ImportPreviewSummary {
  create: number;
  update: number;
  unchanged: number;
  skip: number;
  error: number;
}

const ACTION_LABEL_KEY: Record<ImportPreviewRow['action'], string> = {
  create: 'importPreview.actionCreate',
  update: 'importPreview.actionUpdate',
  unchanged: 'importPreview.actionUnchanged',
  skip: 'importPreview.actionSkip',
  error: 'importPreview.actionError',
};

const ACTION_TONE: Record<ImportPreviewRow['action'], string> = {
  create: 'ok',
  update: 'warn',
  unchanged: 'muted',
  skip: 'muted',
  error: 'danger',
};

/**
 * Bảng ĐỐI CHIẾU trước khi ghi (AD-15) — dùng chung cho import danh mục (2.1) và
 * import thiết bị (2.6). Luật chung của mọi màn import trong IMS: người dùng thấy
 * TỪNG DÒNG sẽ ra sao rồi mới bấm xác nhận, không có kiểu "đã nhập 217 dòng" rồi mới biết.
 *
 * Mặc định mở ở chế độ "chỉ xem dòng cần chú ý" (lỗi + thay đổi): file 300 dòng mà đổ hết
 * ra thì người ta cuộn mỏi tay và bỏ sót đúng dòng lỗi.
 */
export function ImportPreview({
  rows,
  summary,
}: {
  rows: ImportPreviewRow[];
  summary: ImportPreviewSummary;
}) {
  const { t } = useTranslation();
  const noisy = summary.unchanged + summary.skip;
  const [showAll, setShowAll] = useState(noisy === 0);
  const visible = showAll
    ? rows
    : rows.filter((row) => row.action !== 'unchanged' && row.action !== 'skip');
  /* File khớp hết với dữ liệu đang có: một khối báo xanh thay cho bảng rỗng — bảng trống kèm
     "không có dòng nào" trông như lỗi, không như tin tốt. */
  const nothing = summary.create + summary.update + summary.error === 0;
  const collapsed = nothing && (!showAll || rows.length === 0);

  return (
    <div className="import-preview">
      <div className="import-summary">
        <SummaryChip tone="ok" label={t(ACTION_LABEL_KEY.create)} value={summary.create} />
        <SummaryChip tone="warn" label={t(ACTION_LABEL_KEY.update)} value={summary.update} />
        <SummaryChip tone="muted" label={t(ACTION_LABEL_KEY.unchanged)} value={summary.unchanged} />
        <SummaryChip tone="muted" label={t(ACTION_LABEL_KEY.skip)} value={summary.skip} />
        <SummaryChip tone="danger" label={t(ACTION_LABEL_KEY.error)} value={summary.error} />
      </div>

      {collapsed ? (
        <p className="alert ok" role="status">
          {t('importPreview.allUnchanged')}
        </p>
      ) : null}

      {noisy > 0 ? (
        <button
          type="button"
          className="btn sm ghost import-toggle"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll
            ? t('importPreview.hideNoisy', { count: noisy })
            : t('importPreview.showNoisy', { count: noisy })}
        </button>
      ) : null}

      {collapsed ? null : (
      <div className="table-wrap import-preview-table">
        <table className="table">
          <thead>
            <tr>
              <th>{t('importPreview.item')}</th>
              <th>{t('importPreview.row')}</th>
              <th>{t('importPreview.content')}</th>
              <th>{t('importPreview.result')}</th>
              <th>{t('importPreview.note')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                  {t('importPreview.nothingToWrite')}
                </td>
              </tr>
            ) : null}
            {visible.map((row) => (
              <tr
                key={`${row.group}-${row.rowNumber}-${row.label}`}
                className={row.action === 'error' ? 'row-danger' : undefined}
              >
                <td>{row.group}</td>
                <td className="mono">{row.rowNumber}</td>
                <td>{row.label}</td>
                <td>
                  <span className={`badge ${ACTION_TONE[row.action]}`}>
                    {t(ACTION_LABEL_KEY[row.action])}
                  </span>
                </td>
                <td className="muted">{row.message ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function SummaryChip({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    /* Chip số 0 lùi hẳn xuống (`is-zero`) để mắt rơi vào chip có số — cùng độ đậm thì "Lỗi: 3"
       chìm giữa bốn chip "0". */
    <span className={`badge ${value > 0 ? tone : 'muted is-zero'}`}>
      {label}: {value}
    </span>
  );
}
