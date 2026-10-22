import { describe, expect, it } from 'vitest';
import { recordCodeProblem } from './record-code';

/**
 * PW-A12 (Q-33) — CÙNG bảng dữ liệu với `api/src/common/record-code.spec.ts`: form báo một luật,
 * API chặn một luật khác là tệ hơn không báo.
 */
describe('recordCodeProblem', () => {
  it.each([
    ['PC-HCM-012', '', null],
    ['LIC_2026.01/A', '', null],
    ['HỒ SƠ -1', '', 'format'],
    ['PC 01', '', 'format'],
    ['PC#1', '', 'format'],
    ['pc-01', '', null],
    ['', '', null],
    // Mã khai trước luật: gửi lại đúng mã đang lưu thì không báo.
    ['hồ sơ -1', 'hồ sơ -1', null],
    ['HỒ SƠ -2', 'hồ sơ -1', 'format'],
  ] as const)('%j (đang lưu %j) → %s', (code, original, expected) => {
    expect(recordCodeProblem(code, original)).toBe(expected);
  });
});
