import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sanitizeDiagramSvg } from './diagram-gate';

/*
 * Chế độ Xem vẽ lại đúng SVG đã qua cổng, nên cổng không được làm rơi thứ draw.io vẽ ra. Mẫu là
 * ảnh SVG thật do draw.io (bản ghim trong image `web`) xuất qua lệnh `export` của màn Sửa, cho
 * một bản vẽ có: chữ nhật nhãn HTML (in đậm), đám mây, chữ tự do, hình switch từ thư viện, ảnh
 * PNG, nhãn không HTML, dây vuông góc có điểm gãy + nhãn, mũi tên rời đứt nét, dây có đầu tròn.
 *
 * Chỉ được bỏ: `foreignObject` (nhãn HTML — chữ dự phòng `<text>` ngay sau nó trong `<switch>` vẫn
 * giữ), `<style>` (chỉ khai biến nền "tự đổi", trình xem khai lại) và `<a>` (dòng "Text is not SVG"
 * trỏ về drawio.com).
 */
const RAW = readFileSync(join(__dirname, 'fixtures', 'drawio-export.svg'), 'utf8');
const DROPPED_SUBTREES = ['foreignObject', 'style', 'a'];

/** Đếm thẻ mở theo tên, bỏ qua mọi thứ nằm trong một cây bị bỏ. */
function countTags(svg: string, skip: string[] = []): Map<string, number> {
  const out = new Map<string, number>();
  const stack: string[] = [];
  let skipping = 0;
  for (const m of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      if (stack.pop() && skipping > 0 && skip.includes(name)) skipping -= 1;
      continue;
    }
    if (skipping === 0 && !skip.includes(name)) out.set(name, (out.get(name) ?? 0) + 1);
    if (skip.includes(name) && !selfClosing) skipping += 1;
    if (!selfClosing) stack.push(name);
  }
  return out;
}

describe('độ trung thực của ảnh xem: SVG draw.io qua cổng không rơi hình nào', () => {
  const clean = sanitizeDiagramSvg(RAW, { svgMaxKb: 4096 });

  it('mẫu là SVG draw.io có đủ thứ cần canh', () => {
    const raw = countTags(RAW);
    for (const tag of ['switch', 'foreignObject', 'image', 'ellipse', 'path', 'rect', 'text']) {
      expect(raw.get(tag) ?? 0).toBeGreaterThan(0);
    }
  });

  it('mọi thẻ ngoài ba cây được phép bỏ còn đủ số lượng', () => {
    expect(clean.reason).toBeNull();
    const expected = countTags(RAW, DROPPED_SUBTREES);
    const actual = countTags(clean.value!);
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  it('mọi ô draw.io còn nhóm data-cell-id của nó, mọi nhãn HTML còn chữ dự phòng', () => {
    const ids = (svg: string) => [...svg.matchAll(/data-cell-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(clean.value!)).toEqual(ids(RAW));
    // Mỗi nhãn HTML là một `<switch>` có foreignObject; `<switch>` cuối của tệp chỉ bọc dòng "Text is not SVG".
    const labelled = (RAW.match(/<switch>[\s\S]*?<\/switch>/g) ?? []).filter((b) => b.includes('<foreignObject')).length;
    const switches = (clean.value!.match(/<switch>[\s\S]*?<\/switch>/g) ?? []).filter((b) => b.includes('<text'));
    expect(labelled).toBeGreaterThan(0);
    expect(switches.length).toBe(labelled);
    for (const block of switches) expect(block).toMatch(/<text\b[^>]*>[^<]+<\/text>/);
    for (const label of ['Phòng máy E2E đậm', 'ISP E2E', 'Chữ tự do E2E', 'nhãn dây E2E', 'SW tự do E2E', 'Nhãn thường E2E']) {
      expect(clean.value).toContain(label);
    }
  });

  it('giữ kiểu nét (đứt nét, đầu mũi tên, màu light-dark) và ảnh nhúng', () => {
    expect(clean.value).toMatch(/stroke-dasharray="/);
    expect(clean.value).toContain('light-dark(');
    expect(clean.value).toMatch(/<image\b[^>]*xlink:href="data:image\/png/);
  });
});
