import { formatDateTime } from '@/lib/format';

export interface HistoryEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail?: string | null;
}

/**
 * AD-13: lịch sử nghiệp vụ (đổi hồ sơ, gia hạn, cấp/thu hồi IP, grant break-glass)
 * hiển thị bằng MỘT component này — mọi module chủ chỉ cần map bảng history của mình
 * về `HistoryEntry`. Không màn nào tự dựng timeline riêng.
 */
export function HistoryPanel({
  entries,
  emptyText = 'Chưa có thay đổi nào được ghi nhận.',
}: {
  entries: HistoryEntry[];
  emptyText?: string;
}) {
  if (entries.length === 0) {
    return <p className="muted">{emptyText}</p>;
  }
  return (
    <ol className="history">
      {entries.map((entry) => (
        <li key={entry.id} className="history-item">
          <div className="history-dot" aria-hidden="true" />
          <div className="history-body">
            <p className="history-action">{entry.action}</p>
            {entry.detail ? <p className="history-detail muted">{entry.detail}</p> : null}
            <p className="history-meta muted">
              {entry.actor} · {formatDateTime(entry.at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
