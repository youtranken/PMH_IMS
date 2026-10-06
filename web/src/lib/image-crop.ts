/**
 * Cắt ảnh thiết bị trước khi tải lên (Q-23 06/10, quyết định A) — phần THUẦN (test bảng dữ liệu ở
 * `image-crop.test.ts`) cộng hai hàm chạm canvas của trình duyệt (`loadCropSource`, `renderCrop`,
 * `measurePhotoFit`) mà hộp cắt và ô ảnh gọi.
 *
 * Ảnh máy 1U chụp kèm viền trắng / trong suốt lớn thì khi đặt vào ô 1U (mỏng ~11 : 1) nó co thành
 * một vạch; cắt viền và khoá khung cắt theo mặt tủ 19" thì ảnh lấp vừa đúng ô U.
 */

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSize {
  width: number;
  height: number;
}

/** Mặt tủ 19": rộng 482,6 mm (kể cả tai bắt vít), mỗi U cao 44,45 mm — chuẩn EIA-310. */
export const RACK_FACE_MM = { width: 482.6, unit: 44.45 } as const;

/** Tỉ lệ rộng / cao của mặt máy n U; `null` = không khoá (máy không khai Số U). */
export function rackFaceAspect(units: number | null | undefined): number | null {
  if (typeof units !== 'number' || !Number.isInteger(units) || units <= 0) return null;
  return RACK_FACE_MM.width / (units * RACK_FACE_MM.unit);
}

/** Điểm ảnh coi là trong suốt (alpha thấp hơn mức này). */
const ALPHA_CLEAR = 16;
/** Sai khác màu (tổng ba kênh) vẫn coi là cùng màu nền — chịu được nhiễu nén JPEG. */
const COLOR_TOLERANCE = 30;

/**
 * Khối nội dung của ảnh: bỏ viền trong suốt, hoặc viền cùng màu với góc trên trái (khi cả bốn góc
 * cùng màu — ảnh chụp có nền trắng). Ảnh toàn một màu thì trả cả ảnh: cắt về 0 là mất ảnh.
 */
export function trimBox(data: Uint8ClampedArray, width: number, height: number): CropBox {
  const at = (x: number, y: number) => (y * width + x) * 4;
  const corner = (x: number, y: number) => Array.from(data.subarray(at(x, y), at(x, y) + 4));
  const corners = [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)];
  const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= COLOR_TOLERANCE;
  const ref = corners[0];
  const uniform = ref[3] >= ALPHA_CLEAR && corners.every((c) => c[3] >= ALPHA_CLEAR && same(c, ref));
  const isBackground = (x: number, y: number) => {
    const i = at(x, y);
    if (data[i + 3] < ALPHA_CLEAR) return true;
    return uniform && same([data[i], data[i + 1], data[i + 2]], ref);
  };
  const rowEmpty = (y: number) => {
    for (let x = 0; x < width; x += 1) if (!isBackground(x, y)) return false;
    return true;
  };
  const colEmpty = (x: number, top: number, bottom: number) => {
    for (let y = top; y <= bottom; y += 1) if (!isBackground(x, y)) return false;
    return true;
  };
  let top = 0;
  while (top < height && rowEmpty(top)) top += 1;
  if (top === height) return { x: 0, y: 0, width, height };
  let bottom = height - 1;
  while (bottom > top && rowEmpty(bottom)) bottom -= 1;
  let left = 0;
  while (left < width - 1 && colEmpty(left, top, bottom)) left += 1;
  let right = width - 1;
  while (right > left && colEmpty(right, top, bottom)) right -= 1;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Khung cắt ban đầu theo tỉ lệ khoá: nới cạnh ngắn quanh tâm để không mất nội dung; nới chạm mép
 * ảnh thì thu khung lại cho vừa ảnh (vẫn đúng tỉ lệ). Không khoá thì đúng khối nội dung.
 */
export function lockedCrop(content: CropBox, aspect: number | null, image: CropSize): CropBox {
  if (!aspect) return content;
  let width = content.width;
  let height = content.height;
  if (width / height < aspect) width = height * aspect;
  else height = width / aspect;
  const scale = Math.min(1, image.width / width, image.height / height);
  width *= scale;
  height *= scale;
  const cx = content.x + content.width / 2;
  const cy = content.y + content.height / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), image.width - width);
  const y = Math.min(Math.max(cy - height / 2, 0), image.height - height);
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Dời khung, giữ trong ảnh. */
export function moveCrop(box: CropBox, dx: number, dy: number, image: CropSize): CropBox {
  return {
    ...box,
    x: Math.min(Math.max(box.x + dx, 0), image.width - box.width),
    y: Math.min(Math.max(box.y + dy, 0), image.height - box.height),
  };
}

/** Cạnh nhỏ nhất của khung (điểm ảnh gốc) — khung 0 px là ảnh rỗng. */
const MIN_SIDE = 8;

export type CropCorner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Kéo một góc khung: góc đối diện đứng yên. Khoá tỉ lệ thì cao theo rộng (bề ngang là thứ người
 * kéo nhìn rõ nhất với ảnh dài như máy 1U). Khung không ra ngoài ảnh, không nhỏ hơn `MIN_SIDE`.
 */
export function resizeCrop(box: CropBox, corner: CropCorner, dx: number, dy: number, aspect: number | null, image: CropSize): CropBox {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const anchorX = west ? box.x + box.width : box.x;
  const anchorY = north ? box.y + box.height : box.y;
  const roomX = west ? anchorX : image.width - anchorX;
  const roomY = north ? anchorY : image.height - anchorY;
  let width = Math.min(Math.max(box.width + (west ? -dx : dx), MIN_SIDE), roomX);
  let height = Math.min(Math.max(box.height + (north ? -dy : dy), MIN_SIDE), roomY);
  if (aspect) {
    height = width / aspect;
    if (height > roomY) {
      height = roomY;
      width = height * aspect;
    }
    if (height < MIN_SIDE) {
      height = MIN_SIDE;
      width = Math.min(height * aspect, roomX);
    }
  }
  return {
    x: round(west ? anchorX - width : anchorX),
    y: round(north ? anchorY - height : anchorY),
    width: round(width),
    height: round(height),
  };
}

/** Viền thừa mỗi chiều quá mức này (tỉ lệ cạnh ảnh) thì coi là chưa cắt. */
const MARGIN_SLACK = 0.04;
/** Lệch tỉ lệ mặt tủ quá mức này thì coi là chưa cắt đúng n U. */
const ASPECT_SLACK = 0.12;

/**
 * Ảnh đang dùng (đo trên ảnh đã thu nhỏ của server) cần cắt lại không: `margins` = còn viền,
 * `aspect` = lệch tỉ lệ mặt tủ n U, `null` = ổn.
 */
export function photoFitIssue(size: CropSize, content: CropBox, units: number | null | undefined): 'margins' | 'aspect' | null {
  if (!(size.width > 0 && size.height > 0)) return null;
  if ((size.width - content.width) / size.width > MARGIN_SLACK || (size.height - content.height) / size.height > MARGIN_SLACK) return 'margins';
  const aspect = rackFaceAspect(units);
  if (aspect && Math.abs(size.width / size.height / aspect - 1) > ASPECT_SLACK) return 'aspect';
  return null;
}

/* ---------------------------------------------------------- phần trình duyệt --- */

/** Cạnh dài của bản đo điểm ảnh — tìm viền không cần độ phân giải gốc. */
const SAMPLE_SIDE = 400;

function sample(image: CanvasImageSource, width: number, height: number): { data: Uint8ClampedArray; width: number; height: number; scale: number } | null {
  const scale = Math.min(1, SAMPLE_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  try {
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, scale };
  } catch {
    return null;
  }
}

/** Khối nội dung tính trên ảnh gốc (đo trên bản thu nhỏ rồi nhân ngược). Không đo được → cả ảnh. */
function contentOf(image: CanvasImageSource, size: CropSize): CropBox {
  const s = sample(image, size.width, size.height);
  if (!s) return { x: 0, y: 0, ...size };
  const box = trimBox(s.data, s.width, s.height);
  const k = 1 / s.scale;
  const x = Math.max(0, Math.floor(box.x * k));
  const y = Math.max(0, Math.floor(box.y * k));
  return { x, y, width: Math.min(size.width - x, Math.ceil(box.width * k)), height: Math.min(size.height - y, Math.ceil(box.height * k)) };
}

export interface CropSource {
  url: string;
  image: HTMLImageElement;
  size: CropSize;
  /** Khối nội dung đã bỏ viền. */
  content: CropBox;
}

/** Nạp tệp ảnh cho hộp cắt. Nơi gọi thu hồi `url` khi đóng hộp. */
export function loadCropSource(file: Blob): Promise<CropSource> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const size = { width: image.naturalWidth, height: image.naturalHeight };
      resolve({ url, image, size, content: contentOf(image, size) });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    image.src = url;
  });
}

/** Cạnh dài tối đa của ảnh xuất — đủ nét cho mặt máy, không phình giấy tờ. */
const OUTPUT_MAX_SIDE = 2400;

/**
 * Vẽ vùng cắt ra tệp mới. PNG giữ nền trong suốt; còn lại JPEG. Tên giữ tên gốc (đổi đuôi theo
 * định dạng ra) để danh sách giấy tờ vẫn nhận ra ảnh.
 */
export function renderCrop(source: CropSource, box: CropBox, original: { name: string; type: string }): Promise<File> {
  const png = original.type === 'image/png' || (!original.type && /\.png$/i.test(original.name));
  const type = png ? 'image/png' : 'image/jpeg';
  const scale = Math.min(1, OUTPUT_MAX_SIDE / Math.max(box.width, box.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.width * scale));
  canvas.height = Math.max(1, Math.round(box.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas'));
  ctx.drawImage(source.image, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  const base = original.name.replace(/\.[^.]+$/, '') || 'anh';
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], `${base}.${png ? 'png' : 'jpg'}`, { type })) : reject(new Error('canvas'))),
      type,
      0.92,
    );
  });
}

/** Ảnh đang hiện ở ô ảnh (đã nạp xong) có cần cắt lại không — đo ngay trên `<img>`. */
export function measurePhotoFit(image: HTMLImageElement, units: number | null | undefined): 'margins' | 'aspect' | null {
  const size = { width: image.naturalWidth, height: image.naturalHeight };
  if (!(size.width > 0 && size.height > 0)) return null;
  return photoFitIssue(size, contentOf(image, size), units);
}
