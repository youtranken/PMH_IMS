import {
  createGuardrails,
  NobleCryptoPlugin,
  ScureBase32Plugin,
  TOTP,
} from 'otplib';
import * as QRCode from 'qrcode';

/*
 * Ngăn "Mã 2 lớp" (Q-18, mở rộng FR-021). Giá trị cất vào két luôn là MỘT dạng `otpauth://`
 * chuẩn hoá: lúc mở két server sinh lại QR và mã 6 số từ đúng chuỗi này, nên hai cách nhập
 * (khoá base32 trần, nguyên URI đọc từ QR) phải ra cùng một chuỗi và cùng một mã.
 */

export type TotpSeedReason =
  | 'EMPTY'
  | 'BAD_URI'
  | 'NOT_TOTP'
  | 'BAD_SECRET'
  | 'SECRET_LENGTH'
  | 'BAD_DIGITS'
  | 'BAD_PERIOD'
  | 'BAD_ALGORITHM';

/** Không câu nào nhắc lại chuỗi người dùng gõ: thân lỗi đi qua log, toast và công cụ trình duyệt. */
export const TOTP_SEED_MESSAGES: Record<TotpSeedReason, string> = {
  EMPTY: 'Chưa nhập khoá mã 2 lớp.',
  BAD_URI: 'Chuỗi otpauth:// không đọc được. Dán lại nguyên chuỗi từ mã QR, hoặc chỉ dán khoá bí mật.',
  NOT_TOTP: 'Chỉ nhận mã 2 lớp theo thời gian (TOTP). Mã theo bộ đếm (HOTP) chưa hỗ trợ.',
  BAD_SECRET: 'Khoá bí mật chỉ gồm chữ A–Z và số 2–7 (base32).',
  SECRET_LENGTH: 'Khoá bí mật phải dài từ 16 tới 103 ký tự base32.',
  BAD_DIGITS: 'Mã 2 lớp chỉ nhận loại 6 hoặc 8 chữ số.',
  BAD_PERIOD: 'Mã 2 lớp chỉ nhận chu kỳ 30 giây.',
  BAD_ALGORITHM: 'Thuật toán chỉ nhận SHA1, SHA256 hoặc SHA512.',
};

const ALGORITHMS = { SHA1: 'sha1', SHA256: 'sha256', SHA512: 'sha512' } as const;
type AlgorithmName = keyof typeof ALGORITHMS;

/** Chỉ nhận 30 giây: đó là thứ ứng dụng xác thực nào cũng hiểu; chu kỳ khác nhiều app bỏ qua. */
const PERIOD = 30;

/*
 * otplib mặc định đòi khoá >= 16 byte (khuyến nghị cho khoá MÌNH sinh). Két cất khoá do hệ
 * thống KHÁC cấp, và khoá 10 byte (16 ký tự base32) còn rất phổ biến — từ chối là đẩy người
 * dùng ghi khoá vào ô ghi chú dạng rõ.
 */
const MIN_SECRET_BYTES = 10;
const MAX_SECRET_BYTES = 64;
const GUARDRAILS = createGuardrails({ MIN_SECRET_BYTES, MAX_SECRET_BYTES });

interface TotpParams {
  secret: string;
  issuer: string;
  account: string;
  algorithm: AlgorithmName;
  digits: 6 | 8;
}

export interface NormalizedTotpSeed {
  /** `otpauth://totp/…` chuẩn hoá — `null` khi bị từ chối. */
  value: string | null;
  /** Khoá base32 đã chuẩn hoá — để so với ghi chú (FR-035). */
  secret: string | null;
  reason: TotpSeedReason | null;
}

/**
 * Nhận khoá base32 trần hoặc URI `otpauth://totp/…`. Khoá trần thì issuer là tên ngăn, tài
 * khoản là tên đăng nhập (không có thì tên ngăn): đó là chữ hiện trong ứng dụng xác thực khi
 * quét QR sinh lại, nên phải nhận ra được ngăn nào.
 */
export function normalizeTotpSeed(
  raw: string,
  fallback: { label: string; username?: string | null },
): NormalizedTotpSeed {
  const input = raw.trim();
  if (!input) return rejected('EMPTY');
  const parsed = /^otpauth:/i.test(input) ? parseUri(input, fallback) : parseBare(input, fallback);
  if ('reason' in parsed) return rejected(parsed.reason);
  return { value: buildUri(parsed), secret: parsed.secret, reason: null };
}

function rejected(reason: TotpSeedReason): NormalizedTotpSeed {
  return { value: null, secret: null, reason };
}

function fallbackNames(fallback: { label: string; username?: string | null }) {
  const issuer = fallback.label.trim();
  return { issuer, account: fallback.username?.trim() || issuer };
}

function parseBare(
  input: string,
  fallback: { label: string; username?: string | null },
): TotpParams | { reason: TotpSeedReason } {
  const secret = normalizeSecret(input);
  if (typeof secret !== 'string') return secret;
  return { secret, ...fallbackNames(fallback), algorithm: 'SHA1', digits: 6 };
}

function parseUri(
  input: string,
  fallback: { label: string; username?: string | null },
): TotpParams | { reason: TotpSeedReason } {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { reason: 'BAD_URI' };
  }
  const type = url.host.toLowerCase();
  if (!type) return { reason: 'BAD_URI' };
  if (type !== 'totp') return { reason: 'NOT_TOTP' };

  const secret = normalizeSecret(url.searchParams.get('secret') ?? '');
  if (typeof secret !== 'string') return secret;

  const digitsRaw = url.searchParams.get('digits');
  const digits = digitsRaw === null ? 6 : Number(digitsRaw);
  if (digits !== 6 && digits !== 8) return { reason: 'BAD_DIGITS' };

  const periodRaw = url.searchParams.get('period');
  if (periodRaw !== null && Number(periodRaw) !== PERIOD) return { reason: 'BAD_PERIOD' };

  const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase();
  if (!(algorithm in ALGORITHMS)) return { reason: 'BAD_ALGORITHM' };

  let label: string;
  try {
    label = decodeURIComponent(url.pathname.replace(/^\//, '')).trim();
  } catch {
    return { reason: 'BAD_URI' };
  }
  const colon = label.indexOf(':');
  const prefix = colon >= 0 ? label.slice(0, colon).trim() : '';
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const issuer = url.searchParams.get('issuer')?.trim() || prefix;
  const names = account ? { issuer: issuer || account, account } : fallbackNames(fallback);

  return { secret, ...names, algorithm: algorithm as AlgorithmName, digits };
}

function normalizeSecret(raw: string): string | { reason: TotpSeedReason } {
  const secret = raw.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!secret || !/^[A-Z2-7]+$/.test(secret)) return { reason: 'BAD_SECRET' };
  const bytes = Math.floor((secret.length * 5) / 8);
  if (bytes < MIN_SECRET_BYTES || bytes > MAX_SECRET_BYTES) return { reason: 'SECRET_LENGTH' };
  return secret;
}

function buildUri(params: TotpParams): string {
  const enc = encodeURIComponent;
  return (
    `otpauth://totp/${enc(params.issuer)}:${enc(params.account)}` +
    `?secret=${params.secret}&issuer=${enc(params.issuer)}` +
    `&algorithm=${params.algorithm}&digits=${params.digits}&period=${PERIOD}`
  );
}

export interface TotpRevealView {
  secret: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
  /** Ảnh QR sinh lại mỗi lần mở, chỉ nằm trong phản hồi `no-store` — không bao giờ ghi ra đĩa. */
  qrDataUrl: string;
  /** `codes[0]` là mã hiện tại, mỗi phần tử sau là mã của chu kỳ kế tiếp. */
  codes: string[];
  /** Giây còn lại của chu kỳ hiện tại, tính theo đồng hồ server. */
  secondsLeft: number;
}

/**
 * Nội dung hộp mở két cho ngăn "Mã 2 lớp".
 *
 * Trả sẵn mã của mọi chu kỳ rơi vào khoảng hộp còn hiện (`revealSeconds`): client không phải
 * tự cài HMAC, và không phải gọi lại đường mở két (mỗi lần gọi là một dòng nhật ký "đã xem").
 */
export async function totpRevealView(
  uri: string,
  now: Date,
  revealSeconds: number,
): Promise<TotpRevealView> {
  const parsed = parseUri(uri, { label: '', username: null });
  // Chuỗi trong két đã qua `normalizeTotpSeed` lúc cất; hỏng ở đây là dữ liệu bị sửa tay.
  if ('reason' in parsed) throw new Error(`Ngăn mã 2 lớp chứa chuỗi không hợp lệ (${parsed.reason}).`);

  const totp = new TOTP({
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    algorithm: ALGORITHMS[parsed.algorithm],
    digits: parsed.digits,
    period: PERIOD,
    guardrails: GUARDRAILS,
  });
  const epoch = Math.floor(now.getTime() / 1000);
  const step = Math.floor(epoch / PERIOD);
  const secondsLeft = PERIOD - (epoch % PERIOD);
  const count = 1 + Math.ceil(Math.max(0, revealSeconds - secondsLeft) / PERIOD);
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = await totp.generate({ secret: parsed.secret, epoch: (step + i) * PERIOD });
    codes.push(String(code));
  }

  return {
    secret: parsed.secret,
    issuer: parsed.issuer,
    account: parsed.account,
    digits: parsed.digits,
    period: PERIOD,
    qrDataUrl: await QRCode.toDataURL(buildUri(parsed), { errorCorrectionLevel: 'M', margin: 2 }),
    codes,
    secondsLeft,
  };
}
