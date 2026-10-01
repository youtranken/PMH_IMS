import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/format';

export interface HistoryEntry {
  id: string;
  at: string;
  actor: string;
  /**
   * Họ tên người làm, khi API tra được (`withActorNames`). Có thì hiện tên, email lùi vào
   * tooltip; không có (tài khoản đã xoá, màn chưa tra) thì hiện email như trước.
   */
  actorName?: string;
  action: string;
  detail?: string | null;
  /**
   * Màu của ga (tuỳ chọn): `create` tạo mới, `status` đổi trạng thái, `void` thanh lý / gỡ /
   * thu hồi. Bỏ trống là ga thường. Màu nằm ở CSS theo token, nơi gọi không truyền màu.
   */
  tone?: 'create' | 'status' | 'void';
}

/**
 * AD-13: lịch sử nghiệp vụ (đổi hồ sơ, gia hạn, cấp/thu hồi IP, grant break-glass)
 * hiển thị bằng MỘT component này — mọi module chủ chỉ cần map bảng history của mình
 * về `HistoryEntry`. Không màn nào tự dựng timeline riêng.
 */
export function HistoryPanel({
  entries,
  emptyText,
}: {
  entries: HistoryEntry[];
  emptyText?: string;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return <p className="muted">{emptyText ?? t('history.emptyDefault')}</p>;
  }
  /*
   * Trục dọc "ga tàu" (Q-20): ngày giờ · đường ray + ga · nội dung. API trả mới trước, nên ga
   * ĐẦU là ga mới nhất (tô đặc). Đường ray vẽ bằng CSS giữa các ga, ga cuối không kéo dài.
   * Màn hẹp: ngày giờ xuống dưới nội dung (CSS đổi vị trí ô lưới, DOM giữ nguyên).
   */
  return (
    <ol className="history">
      {entries.map((entry, index) => (
        <li
          key={entry.id}
          className={index === 0 ? 'history-item is-latest' : 'history-item'}
          data-tone={entry.tone}
        >
          <time className="history-time muted" dateTime={entry.at}>
            {formatDateTime(entry.at)}
          </time>
          <div className="history-rail" aria-hidden="true">
            <span className="history-dot" />
          </div>
          <div className="history-body">
            <p className="history-action">{entry.action}</p>
            {entry.detail ? <p className="history-detail muted">{entry.detail}</p> : null}
            <p className="history-meta muted">
              {entry.actorName ? <span title={entry.actor}>{entry.actorName}</span> : entry.actor}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
