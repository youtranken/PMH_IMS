import { BadRequestException } from '@nestjs/common';

/**
 * Luật mã hồ sơ (PW-A12, Q-33): chỉ A–Z 0–9 - _ . / — không dấu, không khoảng trắng. Mã là thứ
 * in lên tem, gõ lại để tìm và in bằng font mono; "hồ sơ -1" vỡ dấu ở cả ba chỗ. Web dùng cùng
 * mẫu (`web/src/lib/record-code.ts`) — đổi một bên thì đổi cả hai.
 */
export const RECORD_CODE_PATTERN = /^[A-Z0-9_./-]+$/;

/** `null` = mã hợp lệ (đã in hoa). */
export function recordCodeProblem(code: string): 'empty' | 'format' | null {
  if (!code) return 'empty';
  return RECORD_CODE_PATTERN.test(code) ? null : 'format';
}

/**
 * Chuẩn hoá + kiểm mã một hồ sơ: cắt hai đầu, in hoa, áp luật. `current` là mã đang lưu (khi
 * Sửa): gửi lại đúng mã đó thì giữ nguyên không kiểm — mã khai trước khi có luật không chặn
 * người ta sửa các ô khác của hồ sơ.
 */
export function recordCode(value: string, label: string, current?: string): string {
  const trimmed = value.trim();
  if (current !== undefined && trimmed === current) return current;
  const code = trimmed.toUpperCase();
  const problem = recordCodeProblem(code);
  if (problem === 'empty') {
    throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `Thiếu ${label}.` });
  }
  if (problem === 'format') {
    throw new BadRequestException({ code: 'CODE_FORMAT_INVALID', message: recordCodeMessage(label) });
  }
  return code;
}

/** Câu báo dùng chung cho form và dòng lỗi của nhập Excel. */
export function recordCodeMessage(label: string): string {
  return `${label} chỉ gồm chữ A–Z, số 0–9 và - _ . / (không dấu, không khoảng trắng).`;
}
