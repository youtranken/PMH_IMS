import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  describedBy?: string;
  initiallyShown?: boolean;
  allowGenerate?: boolean;
}) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(initiallyShown);
  return (
    <div className="secret-input">
      <input
        id={id}
        className="inp mono"
        type={shown ? 'text' : 'password'}
        autoComplete="new-password"
        spellCheck={false}
        autoCapitalize="off"
        required
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
  );
}
