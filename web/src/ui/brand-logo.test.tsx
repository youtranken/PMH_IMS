import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandEmblem, BrandLogo } from './brand-logo';

/** Kích thước thật đọc từ khối IHDR của PNG (byte 16..23). */
function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(join(__dirname, '../../public/brand', file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function imgOf(ui: ReactElement): HTMLImageElement {
  return render(ui).container.querySelector('img')!;
}

describe('ảnh thương hiệu', () => {
  // width/height khai trong code giữ chỗ trước khi ảnh về; lệch với file thật thì ảnh bị méo.
  it.each([
    ['pmh-emblem.png', <BrandEmblem key="e" alt="" />],
    ['pmh-logo.png', <BrandLogo key="l" alt="" />],
  ] as const)('%s: width/height khai trong code khớp file', (file, ui) => {
    const img = imgOf(ui);
    const real = pngSize(file);
    expect(Number(img.getAttribute('width'))).toBe(real.width);
    expect(Number(img.getAttribute('height'))).toBe(real.height);
  });

  // Biểu tượng là hình thoi đủ bốn góc nên gần vuông; bản cắt mất góc dưới thì dẹt hẳn.
  it('biểu tượng gần vuông (đủ góc dưới của hình thoi)', () => {
    const { width, height } = pngSize('pmh-emblem.png');
    expect(Math.abs(width - height) / height).toBeLessThan(0.05);
  });
});
