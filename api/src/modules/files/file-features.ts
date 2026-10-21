import type { Feature } from '../../common/features';
import type { FileOwnerType } from './files.service';

/**
 * Q-31: đính kèm thuộc mảng của chủ thể. Kho file dùng chung nên FeatureGuard không chặn được ở
 * route; thiếu bảng này thì nhóm chỉ có Mạng vẫn tải được giấy tờ của thiết bị bằng id.
 * `Record` để thêm loại chủ thể mà quên khai mảng là lỗi biên dịch.
 */
export const FILE_FEATURES: Record<FileOwnerType, readonly Feature[]> = {
  device: ['assets'],
  isp: ['assets'],
  software: ['assets'],
  service_account: ['assets'],
  device_model: ['assets'],
  software_seat: ['assets'],
  subnet: ['network'],
  nat_rule: ['network'],
  iso_period: ['iso'],
  iso_incident: ['iso_0206'],
};
