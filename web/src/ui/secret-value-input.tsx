import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePicker } from '@/ui/file-picker';
import { generateSecret } from '@/ui/secret-generate';

/**
 * Ô nhập GIÁ TRỊ của két: che mặc định, có nút Hiện/Ẩn, và (tuỳ chọn) nút Tạo ngẫu nhiên.
 *
 * Nhập một lần mà không xem lại được là cất nhầm: license key 25 ký tự gõ mù gần như chắc sai,
 * và phát hiện ra thì đã phải đổi giá trị. Che MẶC ĐỊNH vì người ngồi cạnh không được đọc trộm
 * qua vai — hiện là việc người gõ tự chọn, và `initiallyShown` chỉ dành cho loại không phải mật
 * khẩu (license key).
 *
 * Nút là chữ ("Hiện"/"Ẩn") chứ không `aria-label` chứa "giá trị": tên ô là "Giá trị", và một nút
 * tên "Hiện giá trị" làm mọi `getByLabel('Giá trị')` khớp hai phần tử.
 */
export function SecretValueInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  initiallyShown = false,
  allowGenerate = false,
  qrImport = false,
  required = true,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  describedBy?: string;
  initiallyShown?: boolean;
  allowGenerate?: boolean;
  /**
   * Ngăn "Mã 2 lớp" (Q-18): cho chọn/thả ảnh QR, đọc ngay trên trình duyệt rồi điền chuỗi vào ô.
   * Ảnh không rời máy — ảnh QR chính là khóa dạng rõ.
   */
  qrImport?: boolean;
  /** `false` khi bỏ trống vẫn lưu được (hộp thêm tài khoản dịch vụ: cất mật khẩu sau cũng được). */
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(initiallyShown);
  const [qrStatus, setQrStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const readQr = async (file: File | null) => {
    if (!file) return;
    setQrStatus(null);
    // Nạp bộ giải QR khi cần: chỉ ngăn "Mã 2 lớp" dùng, không bắt mọi màn tải thêm nó.
    const { decodeQrFile } = await import('@/lib/qr-decode');
    const result = await decodeQrFile(file);
    if (result.value) {
      onChange(result.value);
      setQrStatus({ ok: true, text: t('vault.qrReadDone') });
      return;
    }
    setQrStatus({
      ok: false,
      text: t(
        result.reason === 'NOT_IMAGE'
          ? 'vault.qrNotImage'
          : result.reason === 'READ_FAILED'
            ? 'vault.qrReadFailed'
            : 'vault.qrNoCode',
      ),
    });
  };

  return (
    <>
      <div className="secret-input">
        <input
          id={id}
          className="inp mono"
          type={shown ? 'text' : 'password'}
          autoComplete="new-password"
          spellCheck={false}
          autoCapitalize="off"
          required={required}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn sm"
          aria-controls={id}
          aria-pressed={shown}
          onClick={() => setShown((current) => !current)}
        >
          {t(shown ? 'vault.valueHide' : 'vault.valueShow')}
        </button>
        {allowGenerate ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              onChange(generateSecret());
              // Vừa sinh ra thì phải thấy được — người dùng còn phải chép nó sang thiết bị.
              setShown(true);
            }}
          >
            {t('vault.generate')}
          </button>
        ) : null}
      </div>
      {qrImport ? (
        <>
          <FilePicker
            accept="image/*"
            label={t('vault.qrRead')}
            hint={t('vault.qrReadHint')}
            file={null}
            onPick={(file) => void readQr(file)}
          />
          {qrStatus ? (
            <p
              className={qrStatus.ok ? 'muted' : 'alert error'}
              role={qrStatus.ok ? 'status' : 'alert'}
            >
              {qrStatus.text}
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}
