/**
 * Chữ dạng rõ có lộ bí mật không — hàm thuần, có bảng test. Hai luật:
 * - `noteLooksLikeSecret`: ghi chú của ngăn két (Q-18, FR-035).
 * - `textLooksLikeSecret`: ô chữ tự do NGOÀI két — ghi chú, mô tả, lý do của thiết bị, đường
 *   truyền, NAT, IP, dải, tài khoản dịch vụ, ghế license, danh mục, phiếu xin quyền (Q-19, SEC-21).
 *
 * Các cột này không mã hoá, không đòi mã 6 số, không để lại dòng "đã xem" trong nhật ký, lại
 * còn đi vào lịch sử, file xuất và email. Mật khẩu lọt vào đó là đi vòng qua toàn bộ két. Nên
 * server CHẶN, không chỉ nhắc.
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

/**
 * Ô chữ tự do còn hay viết "Speed=1000Mbps", "Office365+Teams", "8080->80", "A|B": ở đó các
 * dấu này nối hai mẩu tên, không phải ký tự đặc biệt của mật khẩu.
 */
const TEXT_SEPARATORS = new Set([...SEPARATORS, ...'=+<>|']);

interface CharClasses {
  lower: boolean;
  upper: boolean;
  digit: boolean;
  special: boolean;
}

function classesOf(token: string, separators: ReadonlySet<string>): CharClasses {
  const found: CharClasses = { lower: false, upper: false, digit: false, special: false };
  for (const ch of token) {
    if (/\p{Ll}/u.test(ch)) found.lower = true;
    else if (/\p{Lu}/u.test(ch)) found.upper = true;
    else if (/\p{Nd}/u.test(ch)) found.digit = true;
    // Dấu thanh tách rời (NFD) là một phần của chữ tiếng Việt, không phải ký tự đặc biệt.
    else if (!/[\p{L}\p{N}\p{M}]/u.test(ch) && !separators.has(ch)) found.special = true;
  }
  return found;
}

function classCount(token: string): number {
  return Object.values(classesOf(token, SEPARATORS)).filter(Boolean).length;
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

/**
 * Luật của ô chữ tự do: cùng độ dài và entropy, nhưng PHẢI có chữ thường và ký tự đặc biệt.
 * Ba nhóm chữ thường · hoa · số không đủ ở đây: "Microsoft365_E3", "Fiber200Mbps-PMH",
 * "Camera_Hikvision_DS-2CD2143G2-I" là tên gói, tên model — và chúng nhiều hơn hẳn mật khẩu
 * trong các ô này. Không có chữ thường thì là mã ("PO#2026-0915", "SR#4-2026-778899").
 */
function strongTextToken(token: string): boolean {
  const c = classesOf(token, TEXT_SEPARATORS);
  return (
    [...token].length >= NOTE_TOKEN_MIN_LENGTH &&
    c.lower &&
    c.special &&
    (c.upper || c.digit) &&
    entropyPerChar(token) >= NOTE_TOKEN_MIN_ENTROPY
  );
}

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]*)(.*)$/i;
const EMAIL_RE = /^[^@\s]+@[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u;
const HOSTNAME_RE = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/u;
/**
 * "portal.pmh.vn/login?next=…", "10.0.0.1:8443/Admin": URL gõ thiếu scheme. Máy phải có tên
 * miền hoặc là IP, và phải có đường dẫn hay tham số theo sau — tên máy trơn đã có `HOSTNAME_RE`.
 */
const BARE_URL_RE =
  /^((?:[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,})|(?:\d{1,3}(?:\.\d{1,3}){3}))(?::\d+)?([/?#].*)$/u;
/**
 * "ssh root@srv-db01", "admin@10.10.20.5": địa chỉ đăng nhập. Máy phải là IP hoặc tên có dấu
 * chấm/gạch nối — "Pmh@Guest2026" có dạng y hệt nhưng là mật khẩu Wi-Fi.
 */
const LOGIN_AT_HOST_RE = /^([^@\s]+)@([\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)+)(?::\d+)?$/u;
/** Tên đăng nhập chỉ có chữ, số và `._-`; "S3cr3t!Pass" trước @ là mật khẩu, không phải tên. */
const LOGIN_NAME_RE = /^[\p{L}\p{N}._-]+$/u;
/** IPv6, có thể kèm zone ("fe80::1%eth0") và độ dài tiền tố: ít nhất hai dấu `:`, chỉ chữ số hex. */
const IPV6_RE = /^(?=[^:]*:[^:]*:)[0-9a-f:]+(?:%[\p{L}\p{N}._-]+)?(?:\/\d{1,3})?$/iu;
/** "Hotline:+84…", "IP:10.0.0.1": nhãn dính liền trước một con số không thuộc về con số đó. */
const LABEL_PREFIX_RE = /^\p{L}+:(?=[+\d])/u;
/** "\\PMH-FS01\data$", "C:\Program Files": đường dẫn Windows. */
const WINDOWS_PATH_RE = /^(\\\\|[a-z]:\\)/i;
/**
 * Product key Windows/Office: 5 nhóm × 5 ký tự. Không có chữ thường, không có ký tự đặc biệt
 * nên luật ô chữ tự do không bắt được — mà đây là bí mật có giá thật, chỗ của nó là két. Dò
 * trên cả đoạn chữ chứ không theo từ: "Key:XXXXX-…", "(XXXXX-…)", "\"XXXXX-…\"" đều là nó.
 */
const PRODUCT_KEY_RE = /(?<![A-Z0-9-])[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}(?![A-Z0-9-])/i;
/**
 * Tên tham số URL mà giá trị của nó LÀ khoá. Ở ô chữ tự do chỉ các tham số này đo bằng luật
 * của két; "?id=Q3Report2026", "?next=Home2026" là mã trang, đo bằng luật ô chữ tự do.
 */
const SECRET_PARAM_RE = /(key|token|secret|pass|pwd|auth|sig|credential)/i;

/** Dấu câu cuối câu không thuộc về từ: "SW-Core01.PMH.local," vẫn là tên máy. */
function trimTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,;)\]]+$/u, '');
}

/** Địa chỉ đăng nhập: trước @ phải là tên đăng nhập, và bản thân nó không phải mật khẩu mạnh. */
function isLoginAddress(token: string): boolean {
  const login = LOGIN_AT_HOST_RE.exec(token);
  return login !== null && LOGIN_NAME_RE.test(login[1]) && !strongToken(login[1]);
}

/** Email, tên máy, IPv6, địa chỉ đăng nhập — địa chỉ chứ không phải mật khẩu. */
function isAddress(token: string): boolean {
  return (
    EMAIL_RE.test(token) || HOSTNAME_RE.test(token) || IPV6_RE.test(token) || isLoginAddress(token)
  );
}

/**
 * Mẩu cần đo của một từ. `#` đứng trước chữ số là "số thứ tự" ("VLAN#10_Mgmt", "Seat#12"), nên
 * hai bên đo riêng; "#" giữa hai chữ cái ("Cisco#Core2026!") vẫn là ký tự của mật khẩu.
 */
function pieces(token: string): string[] {
  return token
    .replace(LABEL_PREFIX_RE, '')
    .split(/#(?=\d)/)
    .filter((piece) => piece !== '');
}

/** Có giá trị tham số nào trông như khoá không. `strongValue(tên, giá trị)` do từng luật chọn. */
function queryHasSecret(rest: string, strongValue: (name: string, value: string) => boolean): boolean {
  const query = rest.split(/[?#]/).slice(1).join('&');
  return query.split('&').some((pair) => {
    const eq = pair.indexOf('=');
    return strongValue(eq >= 0 ? pair.slice(0, eq) : '', pair.slice(eq + 1));
  });
}

/**
 * URL, email, tên máy là địa chỉ chứ không phải mật khẩu — trừ đúng hai chỗ trong URL mang
 * bí mật thật: `user:mật-khẩu@` và giá trị tham số (`?key=…`, `?token=…`). Hai chỗ ấy đo bằng
 * luật của két: đã nằm ở vị trí của khoá thì không cần ký tự đặc biệt.
 */
function tokenLooksLikeSecret(raw: string): boolean {
  const token = trimTrailingPunctuation(raw);
  const url = URL_RE.exec(token);
  if (url) {
    const [, authority, rest] = url;
    const at = authority.lastIndexOf('@');
    if (at >= 0 && authority.slice(0, at).includes(':')) return true;
    return queryHasSecret(rest, (_name, value) => strongToken(value));
  }
  if (isAddress(token)) return false;
  return pieces(token).some((piece) => !isAddress(piece) && strongToken(piece));
}

/** Giá trị tham số ở ô chữ tự do: tên tham số là khoá thì luật két, còn lại luật ô chữ. */
function textParamLooksLikeSecret(name: string, value: string): boolean {
  return SECRET_PARAM_RE.test(name) ? strongToken(value) : strongTextToken(value);
}

/** Một "từ" của ô chữ tự do — cùng các ngoại lệ địa chỉ như két, cộng thêm dạng hay gõ ở đây. */
function textTokenLooksLikeSecret(raw: string): boolean {
  const token = trimTrailingPunctuation(raw);
  const url = URL_RE.exec(token);
  if (url) {
    const [, authority, rest] = url;
    const at = authority.lastIndexOf('@');
    if (at >= 0 && authority.slice(0, at).includes(':')) return true;
    return queryHasSecret(rest, textParamLooksLikeSecret);
  }
  if (isAddress(token)) return false;
  const bare = BARE_URL_RE.exec(token);
  if (bare) {
    const path = bare[2].split(/[?#]/)[0];
    return (
      path.split('/').some((segment) => segment !== '' && strongTextToken(segment)) ||
      queryHasSecret(bare[2], textParamLooksLikeSecret)
    );
  }
  if (WINDOWS_PATH_RE.test(token)) {
    // `$` cuối tên thư mục là share quản trị (C$, ADMIN$, data$), không phải ký tự mật khẩu.
    return token
      .split('\\')
      .some((segment) => segment !== '' && strongTextToken(segment.replace(/\$$/, '')));
  }
  return pieces(token).some((piece) => !isAddress(piece) && strongTextToken(piece));
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

/**
 * Ô chữ tự do ngoài két có một "từ" trông như mật khẩu, hoặc một product key không (Q-19). Luật
 * hẹp hơn `noteLooksLikeSecret` — xem `strongTextToken`. Không bao giờ trả lại chính đoạn chữ:
 * câu lỗi nhắc lại nó là chép bí mật sang thêm một chỗ nữa.
 */
export function textLooksLikeSecret(text: string | null | undefined): boolean {
  if (!text) return false;
  if (PRODUCT_KEY_RE.test(text)) return true;
  return text.split(/\s+/).some((raw) => raw !== '' && textTokenLooksLikeSecret(raw));
}
