import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@/ui/dialog';
import { CopyButton } from '@/ui/copy-button';
import { countdownTone } from '@/ui/countdown-tone';
import { useNow } from '@/ui/use-now';

/**
 * Lớp của một ký tự để TÔ MÀU khi hiện giá trị: gõ tay "Cisco#Core2026!" sang console switch,
 * mắt cần tách được "l" với "1", "O" với "0" — chữ số và ký hiệu mang màu riêng, chữ HOA đậm.
 */
export function secretCharClass(ch: string): 'digit' | 'upper' | 'lower' | 'symbol' {
  if (/[0-9]/.test(ch)) return 'digit';
  if (/[A-Z]/.test(ch)) return 'upper';
  if (/[a-z]/.test(ch)) return 'lower';
  return 'symbol';
}

/** "9:05" — giây lớn (600) đọc không ra là mười phút. */
export function formatMinSec(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Hiện giá trị đúng `seconds` giây rồi tự đóng (FR-022).
 *
 * Đồng hồ đếm ngược tính từ MỘT mốc thời gian chụp lúc mở, không phải trừ dần mỗi giây:
 * trình duyệt ở tab nền bị hãm `setInterval` xuống 1 lần/phút, trừ dần thì cái hộp chứa mật
 * khẩu nằm mở hàng phút trên màn hình đã khóa. Tính từ mốc thì tab quay lại là đóng ngay.
 *
 * Giá trị KHÔNG vào clipboard tự động và không có nút "sao chép": clipboard sống qua cả
 * phiên đăng nhập, dán nhầm vào ô chat là mất luôn. Thay vào đó giá trị tô màu theo lớp ký tự,
 * và có chế độ "từng ký tự" (ô đánh số) để gõ tay không nhầm. Ngoại lệ duy nhất là ngăn
 * "Mã 2 lớp" — xem `TotpBody`.
 *
 * HAI đồng hồ, trả lời hai câu khác nhau, nên nằm ở hai dòng riêng:
 *   `42s` + thanh tiến trình — giá trị này còn hiện bao lâu nữa
 *   `9:12` — còn mở ngăn khác được bao lâu mà không phải gõ lại mã 6 số
 * Thiếu số thứ hai thì người dùng mở ngăn thứ hai lúc 9:09 và bị hỏi mã giữa chừng mà không
 * hiểu vì sao, dù cái mốc đó vốn đoán trước được.
 */
export function RevealDialog(props: RevealProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={props.onClose}
      maxWidth={480}
      title={props.label}
      footer={
        /* Nút thường, không `primary`: lối ra không được là thứ sáng nhất hộp — nội dung mới là. */
        <button type="button" className="btn" onClick={props.onClose}>
          {t('vault.hideNow')}
        </button>
      }
    >
      <RevealContent {...props} />
    </Dialog>
  );
}

/**
 * Cùng nội dung, nhưng là một BƯỚC trong hộp đang mở thay cho hộp chồng lên (VLT-062).
 *
 * Luật giữ nguyên như hộp riêng: đồng hồ tự ẩn, không clipboard, rời bước là giá trị mất khỏi
 * cây React (nơi gọi xóa state khi `onClose`).
 */
export function RevealStep(props: RevealProps) {
  const { t } = useTranslation();
  return (
    <section className="form-grid" data-columns={1} aria-label={props.label}>
      <h3>{props.label}</h3>
      <RevealContent {...props} />
      <div className="row">
        {/* Ẩn = quay về danh sách ngăn: một nút, một nghĩa. */}
        <button type="button" className="btn" onClick={props.onClose}>
          {t('vault.hideNow')}
        </button>
      </div>
    </section>
  );
}

/** Khối `totp` trong phản hồi mở két của ngăn "Mã 2 lớp" — server tính hết (Q-18). */
export interface TotpReveal {
  secret: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
  qrDataUrl: string;
  /** `codes[0]` là mã lúc mở, mỗi phần tử sau là mã của chu kỳ kế tiếp. */
  codes: string[];
  /** Giây còn lại của chu kỳ đầu, theo đồng hồ server. */
  secondsLeft: number;
}

interface RevealProps {
  label: string;
  /** Tên đăng nhập đi kèm — người ta cần CẶP user + mật khẩu, bảng phía sau đã bị hộp che. */
  username?: string | null;
  value: string;
  /** Có thì ngăn là "Mã 2 lớp": hiện khóa + QR + mã hiện tại thay cho chuỗi thô. */
  totp?: TotpReveal;
  seconds: number;
  /** Grace step-up còn lại lúc MỞ, do server tính. Không có thì chỉ hiện một đồng hồ. */
  stepUpSecondsLeft?: number;
  onClose: () => void;
  /**
   * Gọi khi hộp tự đóng VÌ HẾT GIỜ — khác với người dùng bấm Ẩn ngay hay Esc: người vừa quay
   * sang gõ vào thiết bị, nhìn lại thấy hộp mất, phải biết là do hết giờ.
   */
  onExpire?: () => void;
}

function RevealContent({
  label,
  username,
  value,
  totp,
  seconds,
  stepUpSecondsLeft,
  onClose,
  onExpire,
}: RevealProps) {
  const { t } = useTranslation();
  const openedAt = useRef(Date.now());
  const deadline = useRef(openedAt.current + seconds * 1000);
  const [left, setLeft] = useState(seconds);
  const graceTotal = stepUpSecondsLeft ?? 0;
  const [graceLeft, setGraceLeft] = useState(graceTotal);
  const [perChar, setPerChar] = useState(false);

  /*
   * Callback đi qua ref: nơi gọi viết chúng tại chỗ nên mỗi lần cha vẽ lại là hàm mới. Đưa
   * chúng vào deps thì interval bị xoá rồi dựng lại theo mỗi lần vẽ (4 lần/giây, vì chính nhịp
   * đếm làm cha vẽ lại). Ref giữ bản mới nhất mà đồng hồ chỉ dựng một lần.
   */
  const onCloseRef = useRef(onClose);
  const onExpireRef = useRef(onExpire);
  onCloseRef.current = onClose;
  onExpireRef.current = onExpire;
  /** Hết giờ chỉ báo MỘT lần: nơi gọi có thể chưa tháo hộp trước nhịp kế tiếp. */
  const expired = useRef(false);

  useEffect(() => {
    const tick = () => {
      if (expired.current) return;
      const remaining = Math.ceil((deadline.current - Date.now()) / 1000);
      /*
       * Grace đếm từ CÙNG một mốc với đồng hồ tự ẩn, nên hai số luôn khớp nhau. Trừ dần mỗi
       * nhịp thì tab nền bị hãm sẽ làm hai số trôi lệch nhau.
       */
      setGraceLeft(Math.max(0, graceTotal - Math.floor((Date.now() - openedAt.current) / 1000)));
      if (remaining <= 0) {
        expired.current = true;
        onExpireRef.current?.();
        onCloseRef.current();
        return;
      }
      setLeft(remaining);
    };
    const timer = setInterval(tick, 250);
    // Quay lại tab sau khi bị hãm nhịp: kiểm ngay, không chờ nhịp kế tiếp.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [graceTotal]);

  const tone = countdownTone(left, seconds);
  const graceTone = countdownTone(graceLeft, graceTotal);
  const chars = Array.from(value);

  return (
    <div className="form-grid" data-columns={1}>
      {username ? (
        <p className="reveal-username">
          {t('vault.username')}: <span className="mono">{username}</span>
        </p>
      ) : null}
      {totp ? (
        <TotpBody label={label} totp={totp} />
      ) : perChar ? (
        <ol className="secret-chars" aria-label={t('vault.perCharLabel')}>
          {chars.map((ch, index) => (
            <li key={index} className={`ch-${secretCharClass(ch)}`}>
              <span className="secret-char-no">{index + 1}</span>
              <span className="mono">{ch}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="secret-value mono" data-testid="secret-value">
          {chars.map((ch, index) => (
            <span key={index} className={`ch-${secretCharClass(ch)}`}>
              {ch}
            </span>
          ))}
        </p>
      )}
      {totp ? null : (
        <div>
          <button
            type="button"
            className="btn sm"
          onClick={() => setPerChar((current) => !current)}
        >
            {t(perChar ? 'vault.perCharOff' : 'vault.perCharOn')}
          </button>
        </div>
      )}
      {/* `role="status"` để trình đọc màn hình đọc được mốc còn lại; `aria-live` mặc định
          của status là polite nên nó không cắt ngang mỗi giây. */}
      <p className="countdown" role="status" data-testid="reveal-countdown">
        <span className={`countdown-num ${tone}`}>{left}s</span>
        <span className="countdown-note muted">{t('vault.autoHideShort')}</span>
      </p>
      <div className="reveal-progress" aria-hidden="true">
        <span className={tone} style={{ width: `${(left / Math.max(1, seconds)) * 100}%` }} />
      </div>
      {stepUpSecondsLeft === undefined ? null : (
        <p className="countdown">
          <span className="countdown-note muted">{t('vault.graceLine')}</span>
          <span className={`countdown-num ${graceTone}`} data-testid="stepup-countdown">
            {formatMinSec(graceLeft)}
          </span>
        </p>
      )}
      <p className="muted">
        <small>{t('vault.revealLogged')}</small>
      </p>
    </div>
  );
}

/**
 * Mã hiện tại theo thời gian đã trôi từ lúc mở, trên dãy mã server đưa sẵn.
 *
 * Đếm từ mốc lúc mở, không từ đồng hồ máy so với giờ server: máy lệch giờ vẫn ra đúng mã.
 * `index` vượt dãy nghĩa là hộp đã mở lâu hơn thời gian server tính — không bịa mã.
 */
export function totpCodeAt(
  totp: Pick<TotpReveal, 'codes' | 'secondsLeft' | 'period'>,
  elapsedSeconds: number,
): { code: string | null; left: number } {
  const elapsed = Math.max(0, elapsedSeconds);
  if (elapsed < totp.secondsLeft) {
    return { code: totp.codes[0] ?? null, left: Math.ceil(totp.secondsLeft - elapsed) };
  }
  const after = elapsed - totp.secondsLeft;
  const index = 1 + Math.floor(after / totp.period);
  return { code: totp.codes[index] ?? null, left: Math.ceil(totp.period - (after % totp.period)) };
}

/**
 * Nội dung ngăn "Mã 2 lớp" (Q-18).
 *
 * Có nút chép — ngoại lệ có chủ ý so với luật "két không có nút chép": mở két trên điện thoại
 * thì không quét được QR trên chính màn hình đó, chép khóa rồi dán vào ứng dụng xác thực là
 * cách cài duy nhất (cùng lý do với màn cài 2 lớp). Mã 6 số tự hết hạn sau một chu kỳ.
 * Khóa vẫn che mặc định vì người đứng sau lưng không cần QR để chép tay 16 ký tự.
 */
function TotpBody({ label, totp }: { label: string; totp: TotpReveal }) {
  const { t } = useTranslation();
  const openedAt = useRef(Date.now());
  const now = useNow(250);
  const [shown, setShown] = useState(false);
  const { code, left } = totpCodeAt(totp, (now - openedAt.current) / 1000);
  const half = totp.digits / 2;
  const groups = totp.secret.match(/.{1,4}/g) ?? [totp.secret];

  return (
    <>
      <div className="totp-qr-frame">
        <img
          className="totp-qr"
          src={totp.qrDataUrl}
          alt={t('vault.totpQrAlt', { label })}
          width={200}
          height={200}
        />
      </div>
      <p className="muted">{t('vault.totpAccount', { issuer: totp.issuer, account: totp.account })}</p>
      <div>
        <span className="totp-secret-label">{t('vault.totpCode')}</span>
        <div className="totp-secret-box">
          {code ? (
            <code data-testid="totp-code">
              {code.slice(0, half)} {code.slice(half)}
            </code>
          ) : (
            <span className="muted">{t('vault.totpCodeOut')}</span>
          )}
          {code ? (
            <span className="countdown">
              <span className="countdown-note muted">{t('vault.totpCodeLeftNote')}</span>
              <span
                className={`countdown-num ${countdownTone(left, totp.period)}`}
                data-testid="totp-code-left"
              >
                {t('vault.totpCodeLeft', { seconds: left })}
              </span>
            </span>
          ) : null}
          {code ? <CopyButton value={code} label={t('vault.totpCopyCode')} /> : null}
        </div>
      </div>
      <div>
        <span className="totp-secret-label">{t('vault.totpSecret')}</span>
        <div className="totp-secret-box">
          {shown ? (
            <code data-testid="totp-secret">
              {groups.map((group, index) => (
                <span key={index}>{group}</span>
              ))}
            </code>
          ) : (
            <span className="muted">{t('vault.totpSecretMasked')}</span>
          )}
          <button
            type="button"
            className="btn sm"
            onClick={() => setShown((current) => !current)}
          >
            {t(shown ? 'vault.totpSecretHide' : 'vault.totpSecretShow')}
          </button>
          <CopyButton value={totp.secret} label={t('vault.totpCopySecret')} />
        </div>
      </div>
    </>
  );
}
