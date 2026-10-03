import type { DevicePhotosService } from '../src/modules/devices/device-photos.service';

/** Bài kiểm không đụng ảnh thật: máy nào cũng chưa có ảnh (bản vẽ dùng biểu tượng loại). */
export const noPhotos = {
  effectivePhotos: () => Promise.resolve(new Map()),
  thumbnail: () => Promise.resolve(null),
} as unknown as DevicePhotosService;
