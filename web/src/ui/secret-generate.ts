/**
 * Sinh một giá trị ngẫu nhiên cho ô Giá trị của két (Cất / Đổi giá trị).
 *
 * Không có ký tự dễ đọc nhầm: giá trị trong két thường phải GÕ TAY sang console switch hay màn
 * đăng nhập camera, và "l" với "1" ở font console là một lần khoá tài khoản thiết bị. Luôn đủ bốn
 * lớp ký tự để qua được chính thanh đo độ khó cạnh ô nhập.
 *
 * `rng` mặc định là `crypto.getRandomValues` — KHÔNG dùng `Math.random` cho mật khẩu. Tham số chỉ
 * để bài kiểm truyền nguồn cố định.
 */
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGIT = '23456789';
const SYMBOL = '#$%&*+-=?@^_!';

/** Ký tự bị loại vì dễ nhầm — bài kiểm canh chúng không bao giờ xuất hiện. */
export const SECRET_AMBIGUOUS = ['0', 'O', 'o', '1', 'l', 'I', '|', '`'];

type Rng = (buf: Uint32Array) => Uint32Array;

const cryptoRng: Rng = (buf) => crypto.getRandomValues(buf);

export function generateSecret(length = 20, rng: Rng = cryptoRng): string {
  const size = Math.max(4, Math.floor(length));
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  const random = rng(new Uint32Array(size * 2));
  const pick = (set: string, i: number) => set[random[i] % set.length];

  // Bốn ký tự đầu mỗi lớp một cái, phần còn lại lấy từ cả bảng, rồi xáo bằng Fisher–Yates.
  const chars = [pick(LOWER, 0), pick(UPPER, 1), pick(DIGIT, 2), pick(SYMBOL, 3)];
  for (let i = 4; i < size; i += 1) chars.push(pick(all, i));
  for (let i = size - 1; i > 0; i -= 1) {
    const j = random[size + i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
