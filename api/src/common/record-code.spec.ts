import { BadRequestException } from '@nestjs/common';
import { recordCode, recordCodeProblem } from './record-code';

/**
 * PW-A12 (Q-33): mã hồ sơ chỉ A–Z 0–9 - _ . / và luôn in hoa. Mã có dấu hay khoảng trắng
 * ("hồ sơ -1") in bằng font mono thì dấu tách khỏi chữ, gõ lại để tìm cũng trượt.
 */
describe('recordCodeProblem', () => {
  it.each([
    ['PC-HCM-012', null],
    ['LIC_2026.01/A', null],
    ['SW7', null],
    ['hồ sơ -1', 'format'],
    ['PC 01', 'format'],
    ['MÁY-01', 'format'],
    ['PC#1', 'format'],
    ['pc-01', 'format'],
    ['', 'empty'],
  ] as const)('%j → %s', (code, expected) => {
    expect(recordCodeProblem(code)).toBe(expected);
  });
});

describe('recordCode', () => {
  it('cắt khoảng trắng hai đầu và in hoa', () => {
    expect(recordCode('  pc-hcm-01 ', 'Mã thiết bị')).toBe('PC-HCM-01');
  });

  it('mã sai luật → 400 CODE_FORMAT_INVALID, nói tên ô', () => {
    let caught: unknown;
    try {
      recordCode('hồ sơ -1', 'Mã hồ sơ');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const body = (caught as BadRequestException).getResponse() as { code: string; message: string };
    expect(body.code).toBe('CODE_FORMAT_INVALID');
    expect(body.message).toContain('Mã hồ sơ');
  });

  it('trống → FIELD_REQUIRED như cũ', () => {
    let caught: unknown;
    try {
      recordCode('   ', 'Mã thiết bị');
    } catch (error) {
      caught = error;
    }
    expect(((caught as BadRequestException).getResponse() as { code: string }).code).toBe('FIELD_REQUIRED');
  });

  /* Mã cũ khai trước luật vẫn lưu được khi sửa ô khác: chỉ kiểm khi mã đổi. */
  it('mã gửi lên trùng mã đang có → giữ nguyên, không kiểm, không in hoa', () => {
    expect(recordCode('hồ sơ -1', 'Mã hồ sơ', 'hồ sơ -1')).toBe('hồ sơ -1');
    expect(recordCode(' hồ sơ -1 ', 'Mã hồ sơ', 'hồ sơ -1')).toBe('hồ sơ -1');
  });

  it('đổi mã cũ sang mã khác → áp luật', () => {
    expect(() => recordCode('hồ sơ -2', 'Mã hồ sơ', 'hồ sơ -1')).toThrow(BadRequestException);
    expect(recordCode('hs-2', 'Mã hồ sơ', 'hồ sơ -1')).toBe('HS-2');
  });
});
