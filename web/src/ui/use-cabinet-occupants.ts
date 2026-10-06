import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { RackOccupant } from '@/lib/rack-units';

/** Khoá cache — nơi ghi tủ / U của máy làm mới nó để lần mở sau thấy chỗ mới. */
export const cabinetOccupantsKey = (cabinetId: string) => ['devices', 'cabinet-occupants', cabinetId] as const;

/**
 * Máy đang chiếm U trong một tủ (danh sách mặc định của `/devices` đã trừ máy thanh lý — máy đó rời
 * tủ thật), để báo chồng U tại chỗ TRƯỚC khi ghi: form thiết bị và hộp "Chuyển máy sang tủ này" của
 * màn sơ đồ. Server vẫn là trọng tài (khoá theo tủ + ràng buộc EXCLUDE).
 */
export function useCabinetOccupants(cabinetId: string | null) {
  return useQuery({
    queryKey: cabinetOccupantsKey(cabinetId ?? ''),
    queryFn: () =>
      apiFetch<{ items: { id: string; code: string; rackUStart?: number | null; rackUSize?: number | null }[] }>(
        `/api/v1/devices?${new URLSearchParams({ cabinetId: cabinetId ?? '', limit: '200' }).toString()}`,
      ),
    enabled: Boolean(cabinetId),
    select: (page): RackOccupant[] =>
      (page.items ?? [])
        .filter((row) => row.rackUStart != null && row.rackUSize != null)
        .map((row) => ({ id: row.id, code: row.code, start: Number(row.rackUStart), size: Number(row.rackUSize) })),
  });
}
