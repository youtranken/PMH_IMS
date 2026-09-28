import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/ui/copy-button';
import { useIsNarrow } from '@/ui/use-narrow';

export interface TotpSetupData {
  secret: string;
  qrDataUrl: string;
  /** `otpauth://` — mở thẳng ứng dụng xác thực trên chính máy đang xem. */
  otpauthUrl?: string;
}

/**
 * Phần "đưa secret vào ứng dụng xác thực" — dùng ở màn cài 2 lớp khi đăng nhập VÀ ở Hồ sơ của
 * tôi (cài lại trên điện thoại mới).
 *
 * Trên điện thoại (≤900px) đây thường CHÍNH LÀ máy cài Authenticator, và không ai quét được QR
 * trên màn hình của chính mình — nên nút mở ứng dụng và nút chép khoá đứng đầu, QR lùi vào phần
 * "Quét từ máy khác". Desktop giữ QR làm chính.
 *
 * `data-testid="totp-secret"` có ở cả hai bố cục: bộ E2E đọc nó để tự sinh mã 6 số.
 */
export function TotpSetup({ data }: { data: TotpSetupData }) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();

  const qr = (
    <div className="totp-qr-frame">
      <img
        className="totp-qr"
        src={data.qrDataUrl}
        alt={t('auth.enrollQrAlt')}
        width={200}
        height={200}
      />
    </div>
  );
  /* 32 ký tự liền một khối thì gõ tay rất dễ lẫn 5/S, 0/O, 2/Z — chia nhóm 4 để dò từng cụm.
     Nhóm tách bằng khoảng cách CSS, không bằng dấu cách: chuỗi chép ra vẫn nguyên văn. */
  const groups = data.secret.match(/.{1,4}/g) ?? [data.secret];
  const secretRow = (
    <div>
      <span className="totp-note totp-secret-label">
        {narrow ? t('auth.secretLabel') : t('auth.enrollManual')}
      </span>
      <div className="totp-secret-box">
        <code data-testid="totp-secret">
          {groups.map((group, i) => (
            <span key={i}>{group}</span>
          ))}
        </code>
        <CopyButton value={data.secret} label={t('auth.copySecret')} />
      </div>
    </div>
  );

  if (!narrow) {
    return (
      <>
        {qr}
        {secretRow}
      </>
    );
  }

  return (
    <>
      <p className="totp-note">{t('auth.enrollPhoneSub')}</p>
      <div className="totp-actions">
        {data.otpauthUrl ? (
          <a className="linkbtn primary" href={data.otpauthUrl}>
            {t('auth.openInAuthenticator')}
          </a>
        ) : null}
        {secretRow}
      </div>
      <details className="totp-other">
        <summary>{t('auth.scanFromOtherDevice')}</summary>
        {qr}
      </details>
    </>
  );
}
