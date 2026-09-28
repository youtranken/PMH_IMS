import { useTranslation } from 'react-i18next';
import { formatDateTime, orDash } from '@/lib/format';
import { MOBILE_CARD_QUERY } from '@/ui/data-table';
import { useMediaQuery } from '@/ui/use-media-query';

/** Một phiên đăng nhập như `GET /auth/sessions` và `GET /accounts/:id/sessions` trả về. */
export interface SessionItem {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  /** Phiên của chính trình duyệt đang xem — không có nút kết thúc. */
  current?: boolean;
}

/*
 * Thứ tự dò CÓ NGHĨA: UA của Edge chứa cả "Chrome" và "Safari", UA của Chrome chứa "Safari",
 * UA Android chứa "Linux", UA iPhone chứa "Mac OS X". Dò cái riêng trước, cái chung sau.
 */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\b/, 'Opera'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];
const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

/**
 * Chuỗi User-Agent → trình duyệt + hệ điều hành người đọc nhận ra được.
 *
 * Người mở danh sách phiên đang hỏi "máy này có phải của tôi không" — trả lời bằng 120 ký tự
 * UA bị cắt giữa chừng thì không ai đọc ra. Không nhận ra được thì trả `null` để nơi gọi hiện
 * câu "trình duyệt không rõ" thay vì đoán sai.
 */
export function describeUserAgent(ua: string | null): { browser: string; os: string } | null {
  if (!ua) return null;
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  return browser && os ? { browser, os } : null;
}

/**
 * Danh sách phiên đăng nhập — dùng ở Hồ sơ của tôi và hộp "Phiên đang mở" của màn Tài khoản
 * (AD-15). Nơi gọi tự hỏi lại và tự gọi API trong `onEnd`: câu hỏi của hai màn khác nhau
 * (đăng xuất máy của mình / buộc người khác ra), nên component không ôm việc đó.
 *
 * Mặc định là THẺ: nút kết thúc phiên luôn thấy được, kể cả ở 390px — đó là lúc cần đá kẻ
 * chiếm tài khoản từ điện thoại. `table` = trên màn rộng hiện bảng gọn để so nhiều phiên.
 */
export function SessionList({
  sessions,
  endLabel,
  onEnd,
  busy = false,
  currentLabel,
  table = false,
}: {
  sessions: SessionItem[];
  endLabel: string;
  onEnd: (session: SessionItem) => void;
  busy?: boolean;
  currentLabel?: string;
  table?: boolean;
}) {
  const { t } = useTranslation();
  const narrow = useMediaQuery(MOBILE_CARD_QUERY);

  const device = (session: SessionItem) => {
    const known = describeUserAgent(session.userAgent);
    return known ? t('sessionList.device', known) : t('sessionList.unknownDevice');
  };

  const endButton = (session: SessionItem, className: string) =>
    session.current ? null : (
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => onEnd(session)}
      >
        {endLabel}
      </button>
    );

  if (table && !narrow) {
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>IP</th>
              <th>{t('sessionList.browser')}</th>
              <th>{t('sessionList.lastSeenHeader')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="mono">{orDash(session.ip)}</td>
                <td>
                  {device(session)}
                  {session.current && currentLabel ? (
                    <span className="badge ok">{currentLabel}</span>
                  ) : null}
                </td>
                <td>{formatDateTime(session.lastSeenAt)}</td>
                <td>{endButton(session, 'btn sm danger')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ul className="session-list">
      {sessions.map((session) => (
        <li key={session.id}>
          <div className="session-list-who">
            <b>
              {session.ip ? `${device(session)} · ${session.ip}` : device(session)}
              {session.current && currentLabel ? (
                <span className="badge ok">{currentLabel}</span>
              ) : null}
            </b>
            <span className="muted">
              {t('sessionList.lastSeen', { time: formatDateTime(session.lastSeenAt) })} ·{' '}
              {t('sessionList.started', { time: formatDateTime(session.createdAt) })}
            </span>
          </div>
          {endButton(session, 'btn sm danger session-list-end')}
        </li>
      ))}
    </ul>
  );
}
