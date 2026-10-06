import { describe, expect, it } from 'vitest';
import { lockedCrop, moveCrop, photoFitIssue, rackFaceAspect, resizeCrop, trimBox } from './image-crop';

/** Ảnh RGBA `w × h` tô `bg`, khối nội dung `box` tô `fg`. */
function pixels(w: number, h: number, bg: number[], fg: number[], box: { x: number; y: number; width: number; height: number } | null) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inside = box && x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;
      data.set(inside ? fg : bg, (y * w + x) * 4);
    }
  }
  return data;
}

const WHITE = [255, 255, 255, 255];
const NEAR_WHITE = [250, 251, 249, 255];
const CLEAR = [0, 0, 0, 0];
const DARK = [40, 40, 40, 255];

describe('rackFaceAspect — mặt tủ 19" 482,6 mm : n × 44,45 mm (rộng / cao)', () => {
  it.each([
    [1, 10.857],
    [2, 5.428],
    [4, 2.714],
  ])('%iU → %f', (units, expected) => {
    expect(rackFaceAspect(units)).toBeCloseTo(expected, 2);
  });
  it.each([[0], [null], [undefined], [-1], [1.5]])('%s → null (cắt tự do)', (units) => {
    expect(rackFaceAspect(units as number | null | undefined)).toBeNull();
  });
});

describe('trimBox — cắt viền trong suốt / gần đồng màu', () => {
  it('viền trắng quanh khối nội dung', () => {
    const box = { x: 10, y: 4, width: 60, height: 12 };
    expect(trimBox(pixels(80, 20, WHITE, DARK, box), 80, 20)).toEqual(box);
  });
  it('viền gần trắng (nhiễu JPEG) vẫn tính là viền', () => {
    const box = { x: 5, y: 5, width: 20, height: 10 };
    expect(trimBox(pixels(30, 20, NEAR_WHITE, DARK, box), 30, 20)).toEqual(box);
  });
  it('viền trong suốt (PNG)', () => {
    const box = { x: 0, y: 3, width: 40, height: 4 };
    expect(trimBox(pixels(40, 10, CLEAR, DARK, box), 40, 10)).toEqual(box);
  });
  it('ảnh không có viền → cả ảnh', () => {
    expect(trimBox(pixels(20, 10, DARK, DARK, null), 20, 10)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });
  it('bốn góc cùng màu TỐI (thân máy đã cắt sát, không phải nền) → không cắt', () => {
    const box = { x: 10, y: 4, width: 60, height: 12 };
    expect(trimBox(pixels(80, 20, DARK, [0, 0, 0, 255], box), 80, 20)).toEqual({ x: 0, y: 0, width: 80, height: 20 });
  });
  it('ảnh toàn một màu → cả ảnh (không cắt về 0)', () => {
    expect(trimBox(pixels(20, 10, WHITE, WHITE, null), 20, 10)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });
});

describe('lockedCrop — khung cắt ban đầu', () => {
  const image = { width: 1000, height: 400 };
  it('không khoá tỉ lệ → đúng khối nội dung', () => {
    const content = { x: 100, y: 100, width: 500, height: 80 };
    expect(lockedCrop(content, null, image)).toEqual(content);
  });
  it('1U: nội dung hẹp hơn tỉ lệ → nới bề rộng quanh tâm, không mất nội dung', () => {
    const box = lockedCrop({ x: 300, y: 100, width: 400, height: 50 }, 10, image);
    expect(box.width / box.height).toBeCloseTo(10, 1);
    expect(box.height).toBe(50);
    expect(box.x).toBeLessThanOrEqual(300);
    expect(box.x + box.width).toBeGreaterThanOrEqual(700);
  });
  it('nội dung rộng hơn tỉ lệ → nới chiều cao', () => {
    const box = lockedCrop({ x: 0, y: 150, width: 1000, height: 50 }, 10, image);
    expect(box.width).toBe(1000);
    expect(box.height).toBeCloseTo(100, 0);
    expect(box.y).toBeCloseTo(125, 0);
  });
  it('nới chạm mép ảnh → thu lại cho vừa ảnh, vẫn đúng tỉ lệ', () => {
    const box = lockedCrop({ x: 0, y: 0, width: 1000, height: 400 }, 10, image);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1000);
    expect(box.y + box.height).toBeLessThanOrEqual(400);
    expect(box.width / box.height).toBeCloseTo(10, 1);
  });
});

describe('moveCrop / resizeCrop — kéo khung', () => {
  const image = { width: 1000, height: 400 };
  it('kéo khung không ra ngoài ảnh', () => {
    expect(moveCrop({ x: 900, y: 300, width: 200, height: 100 }, 500, 500, image)).toEqual({ x: 800, y: 300, width: 200, height: 100 });
  });
  it('kéo góc dưới phải, khoá tỉ lệ → cao theo rộng', () => {
    const box = resizeCrop({ x: 0, y: 0, width: 100, height: 10 }, 'se', 100, 0, 10, image);
    expect(box).toEqual({ x: 0, y: 0, width: 200, height: 20 });
  });
  it('kéo góc trên trái, tự do', () => {
    expect(resizeCrop({ x: 100, y: 100, width: 200, height: 100 }, 'nw', -50, 20, null, image)).toEqual({ x: 50, y: 120, width: 250, height: 80 });
  });
  it('không thu nhỏ quá cỡ tối thiểu', () => {
    const box = resizeCrop({ x: 100, y: 100, width: 200, height: 100 }, 'se', -500, -500, null, image);
    expect(box.width).toBeGreaterThanOrEqual(8);
    expect(box.height).toBeGreaterThanOrEqual(8);
  });
});

describe('photoFitIssue — ảnh cũ chưa cắt chuẩn', () => {
  const size = { width: 1086, height: 100 };
  const whole = { x: 0, y: 0, width: 1086, height: 100 };
  it('đúng tỉ lệ 1U, không viền → không báo', () => {
    expect(photoFitIssue(size, whole, 1)).toBeNull();
  });
  it('còn viền → margins', () => {
    expect(photoFitIssue({ width: 1000, height: 400 }, { x: 100, y: 150, width: 800, height: 80 }, null)).toBe('margins');
  });
  it('không viền nhưng lệch tỉ lệ n U → aspect', () => {
    expect(photoFitIssue(size, whole, 2)).toBe('aspect');
  });
  it('không có Số U → chỉ xét viền', () => {
    expect(photoFitIssue({ width: 300, height: 300 }, { x: 0, y: 0, width: 300, height: 300 }, null)).toBeNull();
  });
});
