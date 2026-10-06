import { createHash } from 'node:crypto';
import { IMAGE_MIN_BYTES, dryImages, hasReservedImageRef, hydrateImages, imageRefs, type StoredImage } from './diagram-images';

/** Ảnh giả đủ lớn để được tách (`IMAGE_MIN_BYTES`), mỗi `seed` một nội dung khác. */
function blob(seed: number, size = IMAGE_MIN_BYTES + 100): Buffer {
  return Buffer.alloc(size, seed);
}

function stored(images: Map<string, { mime: string; bytes: Buffer }>): Map<string, StoredImage> {
  return new Map([...images].map(([sha, img]) => [sha, { mime: img.mime, base64: img.bytes.toString('base64') }]));
}

function roundTrip(text: string): string {
  const dry = dryImages(text);
  return hydrateImages(dry.text, stored(dry.images)).text;
}

const PNG = blob(1).toString('base64');
const JPG = blob(2).toString('base64');

describe('dryImages / hydrateImages — ảnh bản vẽ lưu một lần (Q-23)', () => {
  it.each([
    ['style draw.io (không ;base64)', `<mxCell style="shape=image;image=data:image/png,${PNG};aspect=fixed;"/>`],
    ['style có ;base64', `<mxCell style="image=data:image/png;base64,${PNG}"/>`],
    ['thẻ <image> của SVG', `<svg><image href="data:image/jpeg;base64,${JPG}" width="10"/></svg>`],
    ['xlink:href', `<svg><image xlink:href="data:image/png;base64,${PNG}"/></svg>`],
    ['nằm trong nhãn HTML đã thoát thực thể', `<mxCell value="&lt;img src=&quot;data:image/png;base64,${PNG}&quot;&gt;"/>`],
    ['ảnh SVG nhúng dạng base64', `<image href="data:image/svg+xml;base64,${PNG}"/>`],
  ])('%s: tách ra rồi ghép lại đúng từng byte', (_name, text) => {
    const dry = dryImages(text);
    expect(dry.text).not.toContain('data:image');
    expect(dry.text).toMatch(/ims-img:[bn]:[0-9a-f]{64}/);
    expect(dry.images.size).toBe(1);
    expect(roundTrip(text)).toBe(text);
  });

  it('cùng một ảnh hai lần (cả hai dạng) → một ảnh, hai tham chiếu', () => {
    const text = `<a style="image=data:image/png,${PNG};"/><b href="data:image/png;base64,${PNG}"/>`;
    const dry = dryImages(text);
    expect(dry.images.size).toBe(1);
    expect([...dry.text.matchAll(/ims-img:/g)]).toHaveLength(2);
    expect(dry.refs.size).toBe(1);
    expect(roundTrip(text)).toBe(text);
  });

  it('khoá = SHA-256 của mime + nội dung: cùng byte khác mime là hai ảnh', () => {
    const dry = dryImages(`<a href="data:image/png;base64,${PNG}"/><a href="data:image/jpeg;base64,${PNG}"/>`);
    expect(dry.images.size).toBe(2);
    const sha = createHash('sha256').update('image/png\n').update(blob(1)).digest('hex');
    expect(dry.images.has(sha)).toBe(true);
  });

  it.each([
    ['ảnh nhỏ hơn ngưỡng', `<a href="data:image/png;base64,${blob(3, 20).toString('base64')}"/>`],
    ['base64 không chuẩn (có xuống dòng)', `<a href="data:image/png;base64,${PNG.slice(0, 40)}&#10;${PNG.slice(40)}"/>`],
    ['SVG mã hoá URL, không phải base64', `<a href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E${'%20'.repeat(400)}"/>`],
    ['không phải ảnh', `<a href="data:text/plain;base64,${PNG}"/>`],
  ])('%s: để nguyên', (_name, text) => {
    const dry = dryImages(text);
    if (dry.images.size === 0) expect(dry.text).toBe(text);
    expect(roundTrip(text)).toBe(text);
  });

  it('base64 bị cắt giữa chừng bởi ký tự lạ không bị tách nửa vời', () => {
    const text = `<a href="data:image/png;base64,${PNG}%41"/>`;
    expect(dryImages(text).text).toBe(text);
  });

  it('XML đã khô (bản sao, khôi phục): không ảnh mới, vẫn thấy tham chiếu', () => {
    const dry = dryImages(`<a style="image=data:image/png,${PNG};"/>`);
    const again = dryImages(dry.text);
    expect(again.text).toBe(dry.text);
    expect(again.images.size).toBe(0);
    expect([...again.refs]).toEqual([...dry.refs]);
    expect([...imageRefs(dry.text)]).toEqual([...dry.refs]);
  });

  it('thiếu ảnh trong kho: để nguyên tham chiếu, báo thiếu', () => {
    const dry = dryImages(`<a href="data:image/png;base64,${PNG}"/>`);
    const out = hydrateImages(dry.text, new Map());
    expect(out.text).toBe(dry.text);
    expect(out.missing).toEqual([...dry.refs]);
  });

  it('người dùng gửi sẵn chuỗi dành riêng ims-img: → bị nhận ra', () => {
    expect(hasReservedImageRef('<a value="ims-img:b:' + 'a'.repeat(64) + '"/>')).toBe(true);
    expect(hasReservedImageRef('<a value="ảnh img"/>')).toBe(false);
  });
});
