/**
 * Huy hiệu sẵn sàng của panel "Thiết bị kho" (Q-23 06/10 chiều) — hàm THUẦN, test bảng dữ liệu ở
 * `device-readiness.test.ts`.
 *
 * Mục đích là báo TRƯỚC khi vẽ: máy thiếu U hay ảnh chưa cắt chuẩn thì người vẽ biết ngay ở danh
 * sách, không phải đợi thả vào khung tủ mới thấy. Huy hiệu chỉ báo, không chặn chèn.
 */
export type ReadinessFlag = 'noU' | 'noPhoto' | 'recrop';

export function deviceReadiness(input: {
  cabinetId: string | null;
  rackUStart: number | null;
  /** Có ảnh mặt trước đang dùng (ảnh riêng hoặc ảnh model). */
  hasPhoto: boolean;
  /** Kết quả `measurePhotoFit`; `undefined` = chưa đo xong. */
  photoIssue: 'margins' | 'aspect' | null | undefined;
}): ReadinessFlag[] {
  const flags: ReadinessFlag[] = [];
  if (input.cabinetId && input.rackUStart === null) flags.push('noU');
  if (!input.hasPhoto) flags.push('noPhoto');
  else if (input.photoIssue) flags.push('recrop');
  return flags;
}

/** Cùng luật `PHOTO_IMAGE_RE` của server: ảnh thật là `data:image/…` không phải SVG. */
const PHOTO_URI_RE = /(?:^|;)image=(data:image\/(?!svg)[a-z]+;base64,[A-Za-z0-9+/=]+)/;

/** Ảnh thật trong style ô do `device-looks` dựng; biểu tượng / hình draw.io → `null`. */
export function lookPhotoUri(style: string): string | null {
  return PHOTO_URI_RE.exec(style)?.[1] ?? null;
}
