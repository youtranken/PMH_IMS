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

  return (
    <div className="import-preview">
      <div className="import-summary">
        <SummaryChip tone="ok" label={t(ACTION_LABEL_KEY.create)} value={summary.create} />
        <SummaryChip tone="warn" label={t(ACTION_LABEL_KEY.update)} value={summary.update} />
        <SummaryChip tone="muted" label={t(ACTION_LABEL_KEY.unchanged)} value={summary.unchanged} />
        <SummaryChip tone="muted" label={t(ACTION_LABEL_KEY.skip)} value={summary.skip} />
        <SummaryChip tone="danger" label={t(ACTION_LABEL_KEY.error)} value={summary.error} />
      </div>

      {noisy > 0 ? (
        <button type="button" className="btn sm" onClick={() => setShowAll((v) => !v)}>
          {showAll
            ? t('importPreview.hideNoisy', { count: noisy })
            : t('importPreview.showNoisy', { count: noisy })}
        </button>
      ) : null}

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
    </div>
  );
}

function SummaryChip({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <span className={`badge ${value > 0 ? tone : 'muted'}`}>
      {label}: {value}
    </span>
  );
}
