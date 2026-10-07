import { DEVICE_PHOTOS_KEY } from '@/lib/device-models';

type Side = 'front' | 'back';

interface PhotoFile {
  id: string;
  name: string;
}

/** `GET /devices/:id/photos`. */
export interface DevicePhotos {
  device: Record<Side, PhotoFile | null>;
  model: ({ id: string | null; label: string } & Record<Side, PhotoFile | null>) | null;
  effective: Record<Side, PhotoFile | null>;
}

export const devicePhotosKey = (deviceId: string) => [...DEVICE_PHOTOS_KEY, deviceId];
