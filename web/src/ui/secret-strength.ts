/**
 * Đo độ khó của GIÁ TRỊ SECRET khi người dùng đang gõ — hàm thuần, có bảng test.
 *
 * CẢNH BÁO, KHÔNG CHẶN. Quyết định này có lý do:
 *
 * Phần lớn thứ nằm trong két là mật khẩu của THIẾT BỊ NGOÀI đã tồn tại sẵn — trang quản trị
 * Draytek, camera, NAS, cổng nhà mạng. IMS không đặt ra chúng, IMS chỉ ghi lại. Chặn cứng ở
 * đây không làm mật khẩu của cái camera mạnh lên; nó chỉ làm người dùng bỏ cuộc và ghi mật
 * khẩu thật vào ô "Ghi chú" — chỗ KHÔNG được mã hóa. Một luật chặt quá tay đẩy dữ liệu ra
 * khỏi chỗ an toàn, đúng thứ nó định bảo vệ.
 *
 * Nên: chấm điểm, hiện tick xanh từng điều kiện, nói thẳng "cái này yếu" — rồi vẫn lưu.
 *
 * Luật này CHỈ chạy ở client, và cố ý như vậy: nó là lời khuyên lúc gõ, không phải hàng rào.
 * Hàng rào thật cho mật khẩu ĐĂNG NHẬP IMS nằm ở `api/.../password-policy.ts` (12 ký tự,
 * 3/4 nhóm) — đó mới là thứ IMS tự đặt ra và tự chịu trách nhiệm.
 */
export type SecretRuleKey = 'length' | 'lower' | 'upper' | 'digit' | 'symbol';

/** Ngưỡng độ dài: 8 — mức người dùng yêu cầu, thấp hơn mật khẩu đăng nhập IMS (12) có chủ ý. */
export const SECRET_MIN_LENGTH = 8;

interface SecretRule {
  key: SecretRuleKey;
  met: boolean;
}

export interface SecretStrength {
  rules: SecretRule[];
  /** Số điều kiện đã đạt — dùng cho thanh đo. */
  score: number;
  /** Đủ CẢ NĂM điều kiện. Không đủ thì cảnh báo vàng, vẫn lưu được. */
  strong: boolean;
  /** Ô còn trống: chưa gõ gì thì đừng nhuộm đỏ cả hộp thoại vừa mở ra. */
  empty: boolean;
}

const TESTS: { key: SecretRuleKey; test: (v: string) => boolean }[] = [
  { key: 'length', test: (v) => v.length >= SECRET_MIN_LENGTH },
  { key: 'lower', test: (v) => /[a-z]/.test(v) },
  { key: 'upper', test: (v) => /[A-Z]/.test(v) },
  { key: 'digit', test: (v) => /[0-9]/.test(v) },
  // "Ký tự đặc biệt" = bất cứ thứ gì không phải chữ-số ASCII, kể cả khoảng trắng và tiếng
  // Việt có dấu: mật khẩu thiết bị thật đôi khi có cả hai, và chúng đúng là không đoán dễ.
  { key: 'symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function checkSecretStrength(value: string): SecretStrength {
  const rules = TESTS.map(({ key, test }) => ({ key, met: test(value) }));
  const score = rules.filter((rule) => rule.met).length;
  return { rules, score, strong: score === TESTS.length, empty: value.length === 0 };
}
