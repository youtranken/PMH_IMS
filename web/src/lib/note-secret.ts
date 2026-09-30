/**
 * Ghi chú của ngăn két có lộ bí mật không (Q-18, FR-035) — hàm thuần, có bảng test.
 *
 * Ghi chú là cột dạng rõ: không mã hoá, không đòi mã 6 số, không để lại dòng "đã xem" trong
 * nhật ký. Mật khẩu lọt vào đó là đi vòng qua toàn bộ két. Nên server CHẶN, không chỉ nhắc.
 *
 * File này có BẢN SAO y hệt ở `web/src/lib/note-secret.ts` (hai gói npm rời nhau, không import
 * qua lại được): form báo lỗi ngay khi gõ, server vẫn là nơi phán. `note-secret-mirror.spec.ts`
 * so hai file từng byte — sửa một bên thì chép sang bên kia.
 */

/**
 * Giá trị ngắn hơn ngưỡng này chỉ bị chặn khi ghi chú Y HỆT nó: tìm "admin" hay "1234" bên
 * trong một câu thì câu nào cũng dính, và người dùng sẽ học cách lách chứ không học luật.
 */
export const NOTE_VALUE_MIN_LENGTH = 6;

/** Một "từ" ngắn hơn thế thì không đủ dài để là mật khẩu thiết bị đáng kể. */
export const NOTE_TOKEN_MIN_LENGTH = 10;

/** Số nhóm ký tự tối thiểu (thường · hoa · số · ký tự đặc biệt) — cùng mức 3/4 của NFR-01. */
export const NOTE_TOKEN_MIN_CLASSES = 3;

/**
 * Entropy Shannon tối thiểu (bit/ký tự). Loại chuỗi lặp vô nghĩa ("Aaaaaaaaa1!"), vẫn giữ
 * mật khẩu có vài ký tự lặp ("Admin@1212" ≈ 2,9).
 */
export const NOTE_TOKEN_MIN_ENTROPY = 2.5;

/**
 * Dấu nối trong mã máy, tên miền, đường dẫn, ngày giờ ("WS-C2960X-48TS-L", "Gi1/0/24",
 * "2026-10-15T08:00"). Tính chúng là "ký tự đặc biệt" thì mọi mã model đều thành mật khẩu.
 */
const SEPARATORS = new Set([...'.,;:/\\-_()[]{}\'"']);

/** Bỏ khoảng trắng + hạ chữ thường: "Cisco # Core" và "cisco#core" là một chuỗi với người đọc. */
function squash(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** Ghi chú có chứa chính giá trị đang cất không. So được khi cả hai cùng nằm trong request. */
export function noteContainsSecret(note: string | null | undefined, value: string): boolean {
  const n = squash(note ?? '');
  const v = squash(value);
  if (!n || !v) return false;
  if (n === v) return true;
  return v.length >= NOTE_VALUE_MIN_LENGTH && n.includes(v);
}

function classCount(token: string): number {
  let lower = false;
  let upper = false;
  let digit = false;
  let special = false;
  for (const ch of token) {
    if (/\p{Ll}/u.test(ch)) lower = true;
    else if (/\p{Lu}/u.test(ch)) upper = true;
    else if (/\p{Nd}/u.test(ch)) digit = true;
    // Dấu thanh tách rời (NFD) là một phần của chữ tiếng Việt, không phải ký tự đặc biệt.
    else if (!/[\p{L}\p{N}\p{M}]/u.test(ch) && !SEPARATORS.has(ch)) special = true;
  }
  return [lower, upper, digit, special].filter(Boolean).length;
}

function entropyPerChar(token: string): number {
  const chars = [...token];
  const counts = new Map<string, number>();
  for (const ch of chars) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / chars.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function strongToken(token: string): boolean {
  return (
    [...token].length >= NOTE_TOKEN_MIN_LENGTH &&
    classCount(token) >= NOTE_TOKEN_MIN_CLASSES &&
    entropyPerChar(token) >= NOTE_TOKEN_MIN_ENTROPY
  );
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]*)(.*)$/i;
const EMAIL_RE = /^[^@\s]+@[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u;
const HOSTNAME_RE = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u;

/**
 * URL, email, tên máy là địa chỉ chứ không phải mật khẩu — trừ đúng hai chỗ trong URL mang
 * bí mật thật: `user:mật-khẩu@` và giá trị tham số (`?key=…`, `?token=…`).
 */
function tokenLooksLikeSecret(raw: string): boolean {
  // Dấu câu cuối câu không thuộc về từ: "SW-Core01.PMH.local," vẫn là tên máy.
  const token = raw.replace(/[.,;)\]]+$/u, '');
  const url = URL_RE.exec(token);
  if (url) {
    const [, authority, rest] = url;
    const at = authority.lastIndexOf('@');
    if (at >= 0 && authority.slice(0, at).includes(':')) return true;
    const query = rest.split(/[?#]/).slice(1).join('&');
    return query
      .split('&')
      .map((pair) => pair.slice(pair.indexOf('=') + 1))
      .some(strongToken);
  }
  if (EMAIL_RE.test(token) || HOSTNAME_RE.test(token)) return false;
  return strongToken(token);
}

/**
 * Ghi chú có một "từ" (tách bằng khoảng trắng) trông như mật khẩu không. Dùng ở mọi đường ghi
 * ghi chú, kể cả sửa riêng ghi chú — đường đó không có giá trị để so, và giải mã ra để so là
 * một lần mở két không ai xin.
 */
export function noteLooksLikeSecret(note: string | null | undefined): boolean {
  if (!note) return false;
  return note.split(/\s+/).some((token) => token !== '' && tokenLooksLikeSecret(token));
}
