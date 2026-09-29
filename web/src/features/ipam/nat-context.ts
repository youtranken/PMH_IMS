import type { ServicePortRow } from '@/lib/catalog-types';

type Protocol = 'tcp' | 'udp' | 'both';

/**
 * Tên dịch vụ của một cổng trong, lấy từ danh mục "Dịch vụ/port" (không phải bảng cứng: mỗi
 * nơi đặt tên dịch vụ của mình). Chỉ nói khi chắc: giao thức phải phủ được giao thức của rule
 * (dịch vụ "both" phủ mọi thứ; rule "both" chỉ khớp dịch vụ "both"). Mục một cổng thắng mục
 * dải — "8080 Web phụ" cụ thể hơn "8000–8100".
 */
export function serviceNameFor(
  port: number,
  protocol: Protocol,
  services: Pick<ServicePortRow, 'name' | 'protocol' | 'portFrom' | 'portTo'>[],
): string | null {
  const covers = (service: { protocol: Protocol }) =>
    service.protocol === 'both' || service.protocol === protocol;
  const hits = services.filter(
    (service) => covers(service) && service.portFrom <= port && port <= service.portTo,
  );
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.portTo - a.portFrom - (b.portTo - b.portFrom));
  return hits[0].name;
}

/** IP WAN theo thiết bị biên — rule NAT trên router nào thì đi ra WAN của đường gắn router đó. */
export function wanByRouter(
  lines: { deviceId: string | null; wanIp: string | null }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const line of lines) {
    if (!line.deviceId || !line.wanIp) continue;
    map.set(line.deviceId, [...(map.get(line.deviceId) ?? []), line.wanIp]);
  }
  return map;
}
