import { readFileSync } from 'node:fs';
import { redactMessage } from './log-redact';

/**
 * AD-11: bí mật (master key, pepper, SMTP pass) đọc từ FILE docker secret — không env,
 * không DB. Env chỉ được chứa ĐƯỜNG DẪN tới file.
 *
 * Đọc đồng bộ một lần lúc khởi động: thiếu secret thì process phải chết ngay,
 * không chạy nửa vời rồi hỏng lúc user đăng nhập.
 */
export function readSecretFile(envVar: string, required = true): string {
  const path = process.env[envVar];
  if (!path) {
    if (!required) return '';
    throw new Error(
      `Thiếu biến ${envVar} (đường dẫn file docker secret) — api từ chối khởi động (AD-11).`,
    );
  }
  try {
    const value = readFileSync(path, 'utf8').trim();
    if (!value && required) {
      throw new Error(`File secret ${path} rỗng.`);
    }
    return value;
  } catch (error) {
    throw new Error(
      `Không đọc được secret từ ${envVar}=${path}: ${redactMessage(error)}`,
      { cause: error },
    );
  }
}
