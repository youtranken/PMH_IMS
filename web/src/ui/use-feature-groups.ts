import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/** Nhóm quyền của Thành viên (Q-31), đúng shape `GET /api/v1/feature-groups`. */
export interface FeatureGroup {
  id: string;
  name: string;
  features: string[];
  memberCount: number;
}

export const FEATURE_GROUPS_KEY = ['feature-groups'] as const;

/**
 * Danh sách nhóm quyền — màn Nhóm quyền và màn Người dùng IMS (cột nhóm, ô chọn nhóm) dùng chung
 * một truy vấn. API chỉ cho SA: nơi gọi truyền `enabled = false` cho vai khác.
 */
export function useFeatureGroups(enabled = true) {
  return useQuery({
    queryKey: FEATURE_GROUPS_KEY,
    queryFn: () => apiFetch<FeatureGroup[]>('/api/v1/feature-groups'),
    enabled,
  });
}
