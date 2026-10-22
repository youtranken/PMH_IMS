import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DS-30 (Q-33): giấy phiếu ISO không có chữ nhỏ hơn sàn 12px của thang chữ (`--fs-xs`); dải tiêu
 * đề mục (nền xanh) đậm hẳn để tách khỏi dòng nhãn bên dưới.
 */
const sheet = readFileSync(join(__dirname, 'sheet.css'), 'utf8');

function rules(): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(sheet); m; m = re.exec(sheet)) {
    out.push({ selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2] });
  }
  return out;
}

describe('Giấy phiếu ISO — DS-30', () => {
  it('chữ trên giấy chỉ dùng token thang chữ (không co theo em xuống dưới 12px)', () => {
    const shrunk = rules().filter(
      (r) =>
        r.selector.includes('.paper') &&
        !r.selector.includes('.paper-box') &&
        /font-size:(?!\s*var\(--fs-)/.test(r.body),
    );
    expect(shrunk.map((r) => r.selector)).toEqual([]);
  });

  it('dải tiêu đề mục đậm', () => {
    const band = rules().filter((r) => /\.paper-band\b/.test(r.selector));
    expect(band.some((r) => /font-weight:\s*var\(--fw-bold\)/.test(r.body))).toBe(true);
  });
});
