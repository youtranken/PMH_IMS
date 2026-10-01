import { useTranslation } from 'react-i18next';
import { RuleMark } from '@/ui/glyph-icons';
import { checkSecretStrength, type SecretRuleKey } from './secret-strength';

/**
 * Thanh đo độ khó + danh sách điều kiện, TICK XANH ngay khi gõ đủ từng phần.
 *
 * Vì sao là danh sách chứ không phải một chữ "Yếu/Khá/Mạnh": chữ đó nói người dùng SAI mà
 * không nói sai ở đâu. Người ta thêm bừa một dấu `!` vào cuối rồi thử lại, thấy vẫn "Yếu",
 * và bỏ cuộc. Năm dòng có tick thì nhìn phát biết còn thiếu đúng cái gì.
 *
 * Đây là LỜI KHUYÊN, không phải hàng rào — xem chú thích ở `secret-strength.ts`. Nút Lưu
 * không bao giờ bị khóa vì thanh này.
 */
const RULE_KEY: Record<SecretRuleKey, string> = {
  length: 'vault.strengthLength',
  lower: 'vault.strengthLower',
  upper: 'vault.strengthUpper',
  digit: 'vault.strengthDigit',
  symbol: 'vault.strengthSymbol',
};

export function SecretStrengthMeter({ value }: { value: string }) {
  const { t } = useTranslation();
  const strength = checkSecretStrength(value);

  /* Chưa gõ gì thì không bày ra năm dấu ✕ đỏ ngay khi hộp thoại vừa mở — đó là chê người
     dùng trước cả khi họ kịp gõ. Danh sách chỉ hiện từ ký tự đầu tiên. */
  if (strength.empty) return null;

  return (
    <div className="strength" data-testid="secret-strength">
      <div
        className="strength-bar"
        role="meter"
        aria-valuenow={strength.score}
        aria-valuemin={0}
        aria-valuemax={strength.rules.length}
        aria-label={t('vault.strengthLabel')}
      >
        {strength.rules.map((rule) => (
          <span key={rule.key} className={`strength-seg${rule.met ? ' met' : ''}`} />
        ))}
      </div>
      <ul className="strength-rules">
        {strength.rules.map((rule) => (
          <li key={rule.key} className={rule.met ? 'met' : undefined} data-rule={rule.key}>
            {/* Ký hiệu là trang trí — trạng thái thật đọc qua chữ trong ngoặc cho trình đọc
                màn hình, không để người mù chỉ nghe được tên điều kiện mà không biết đạt chưa. */}
            <RuleMark met={rule.met} /> {t(RULE_KEY[rule.key])}
            <span className="sr-only">
              {rule.met ? t('vault.strengthMet') : t('vault.strengthMissing')}
            </span>
          </li>
        ))}
      </ul>
      {strength.strong ? null : (
        <p className="field-hint warn-text" data-testid="secret-strength-warning">
          {t('vault.strengthWeak')}
        </p>
      )}
    </div>
  );
}
