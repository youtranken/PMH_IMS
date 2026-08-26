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

const ACTION_LABEL: Record<ImportPreviewRow['action'], string> = {
  create: 'Thêm mới',
  update: 'Cập nhật',
  unchanged: 'Không đổi',
  skip: 'Bỏ qua',
  error: 'Lỗi',
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
        <SummaryChip tone="ok" label="Thêm mới" value={summary.create} />
        <SummaryChip tone="warn" label="Cập nhật" value={summary.update} />
        <SummaryChip tone="muted" label="Không đổi" value={summary.unchanged} />
        <SummaryChip tone="muted" label="Bỏ qua" value={summary.skip} />
        <SummaryChip tone="danger" label="Lỗi" value={summary.error} />
      </div>

      {noisy > 0 ? (
        <button type="button" className="btn sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? `Ẩn ${noisy} dòng không đổi / bỏ qua` : `Hiện cả ${noisy} dòng không đổi / bỏ qua`}
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
                  Không có dòng nào cần ghi.
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
                    {ACTION_LABEL[row.action]}
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
