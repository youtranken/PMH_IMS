import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { PortPanelData } from '@/lib/port-types';

/** Khoá cache nằm dưới `['devices', id]`: mọi lượt làm mới hồ sơ máy / sơ đồ cổng kéo theo nó. */
export const portPanelKey = (deviceId: string) => ['devices', deviceId, 'port-panel'] as const;

/**
 * Mặt cổng của một máy (`GET /devices/:id/port-panel`, Q-26) — dùng ở tab Cổng (`PortFace`) và ở hai
 * hộp khai dây (gợi ý cổng trống, báo tên ngoài danh sách). `null` = chưa chọn máy.
 */
export function usePortPanel(deviceId: string | null) {
  return useQuery({
    queryKey: portPanelKey(deviceId ?? ''),
    queryFn: () => apiFetch<PortPanelData>(`/api/v1/devices/${deviceId}/port-panel`),
    enabled: Boolean(deviceId),
  });
}
