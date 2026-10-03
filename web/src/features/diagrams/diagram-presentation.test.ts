import { describe, expect, it } from 'vitest';
import {
  fitImageSize,
  imageCellSpec,
  imageDataUrlReason,
  newerOfficialSeq,
  placeFreeCells,
  plannedCellSpec,
  sniffImageMime,
  type PresentationSource,
} from './diagram-presentation';

const SOURCE: PresentationSource = { diagramId: 's', name: 'Tầng 1', versionId: 'v3', seq: 3, officialVersionId: 'v3', officialSeq: 3 };

describe('newerOfficialSeq — cùng luật với server', () => {
  it.each([
    ['vẫn đúng bản đã chép', SOURCE, null],
    ['bản gốc có bản chính thức mới', { ...SOURCE, officialVersionId: 'v5', officialSeq: 5 }, 5],
    ['bản gốc mất cờ chính thức', { ...SOURCE, officialVersionId: null, officialSeq: null }, null],
    ['nguồn đã bị dọn', { ...SOURCE, versionId: null, seq: null }, null],
    ['không có nguồn', null, null],
  ] as const)('%s', (_name, source, expected) => {
    expect(newerOfficialSeq(source)).toBe(expected);
  });
});

describe('plannedCellSpec — thiết bị dự kiến (AD-18: ims_planned="1")', () => {
  it('thuộc tính ims_planned*, viền đứt, nhãn có chữ "Dự kiến"', () => {
    const spec = plannedCellSpec({ name: ' AP tầng 3 ', model: 'U6-Pro', price: '3.500.000', vendor: 'NCC E2E' }, 'Dự kiến');
    expect(spec.attrs).toEqual([
      ['ims_planned', '1'],
      ['ims_planned_model', 'U6-Pro'],
      ['ims_planned_price', '3.500.000'],
      ['ims_planned_vendor', 'NCC E2E'],
    ]);
    expect(spec.style).toContain('dashed=1');
    expect(spec.style).toContain('html=0');
    expect(spec.label).toBe('AP tầng 3\nU6-Pro\nDự kiến · 3.500.000 · NCC E2E');
  });

  it('trường trống không ghi thuộc tính rỗng; dấu < > bị bỏ (nhãn không bao giờ là HTML)', () => {
    const spec = plannedCellSpec({ name: 'AP <b>mới</b>', model: '', price: '', vendor: '' }, 'Dự kiến');
    expect(spec.attrs).toEqual([['ims_planned', '1']]);
    expect(spec.label).toBe('AP bmới/b\nDự kiến');
  });
});

describe('ảnh tự do — chỉ png/jpeg/webp, nhận theo nội dung chứ không theo đuôi tệp', () => {
  const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)]);
  it.each([
    ['png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['jpeg', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['webp', bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50), 'image/webp'],
    ['gif không nhận', bytes(0x47, 0x49, 0x46, 0x38), null],
    ['svg không nhận', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), null],
    ['RIFF không phải WEBP', bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20), null],
  ] as const)('%s', (_name, data, expected) => {
    expect(sniffImageMime(data)).toBe(expected);
  });

  it('ảnh vượt trần cỡ bản vẽ → lý do; vừa trần → null', () => {
    expect(imageDataUrlReason('data:image/png,' + 'A'.repeat(2048), 1)).toMatch(/1 KB/);
    expect(imageDataUrlReason('data:image/png,' + 'A'.repeat(100), 1)).toBeNull();
  });

  it('cỡ hình thu về trong khung, giữ tỉ lệ; không biết cỡ thì khung mặc định', () => {
    expect(fitImageSize(1600, 800, 320)).toEqual({ width: 320, height: 160 });
    expect(fitImageSize(100, 50, 320)).toEqual({ width: 100, height: 50 });
    expect(fitImageSize(0, 0, 320)).toEqual({ width: 320, height: 240 });
  });

  it('ô ảnh: data URI theo lối draw.io (không ";base64" trong style), không thuộc tính ims_*', () => {
    const spec = imageCellSpec('data:image/png;base64,iVBORw0KGgo=', { width: 100, height: 50 });
    expect(spec.style).toContain('image=data:image/png,iVBORw0KGgo=;');
    expect(spec.style).not.toContain(';base64');
    expect(spec.attrs).toEqual([]);
    expect(spec.width).toBe(100);
  });
});

describe('placeFreeCells — chèn bên phải khối hình đang có, chuỗi previous', () => {
  it('hai ô liên tiếp không đè nhau, ô sau nằm trên ô trước', () => {
    let n = 0;
    const spec = plannedCellSpec({ name: 'AP', model: '', price: '', vendor: '' }, 'Dự kiến');
    const placed = placeFreeCells([spec, spec], { bounds: { x: 0, y: 0, width: 100, height: 40 }, parent: '1', previous: 'c9', newId: () => `n${++n}` });
    expect(placed.cells.map((c) => c.previous)).toEqual(['c9', 'n1']);
    expect(placed.cells[0].geometry).toContain('x="140"');
    expect(placed.cells[1].geometry).not.toContain('x="140"');
    expect(placed.cells[0].xmlValue).toContain('ims_planned="1"');
    expect(placed.cells[0].xmlValue).toContain('label="AP&#xa;Dự kiến"');
  });
});
