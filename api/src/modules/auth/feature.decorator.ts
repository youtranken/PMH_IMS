import { SetMetadata } from '@nestjs/common';
import type { Feature as FeatureKey } from '../../common/features';

export const FEATURE_KEY = 'ims:feature';

/**
 * Q-31: route thuộc mảng nào. Member có nhóm quyền phải có ÍT NHẤT MỘT trong các tính năng khai
 * ở đây, không thì 403. Khai ở lớp thì phủ mọi route; khai ở route thì thắng khai ở lớp.
 */
export const Feature = (...features: [FeatureKey, ...FeatureKey[]]) => SetMetadata(FEATURE_KEY, features);

/**
 * Route không thuộc mảng nào hoặc là tra cứu dùng chung (ô chọn thiết bị, danh mục…): nhóm quyền
 * không chặn. Phải khai tường minh, cùng lẽ với `@Roles`: quên khai là 403, không phải mở.
 */
export const FeatureFree = () => SetMetadata(FEATURE_KEY, []);
