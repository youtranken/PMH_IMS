import type { NatProtocol } from './nat-rule.service';

export const NAT_STATES = ['open', 'off', 'voided'] as const;
export type NatState = (typeof NAT_STATES)[number];
export const NAT_EXPORT_SORTS = ['external', 'router', 'internal', 'newest'] as const;
export type NatExportSort = (typeof NAT_EXPORT_SORTS)[number];

interface NatExportable {
  deviceCode: string | null;
  protocol: NatProtocol;
  externalFrom: number;
  externalTo: number;
  internalIp: string;
  internalPort: number;
  enabled: boolean;
  voidedAt: Date | null;
  createdAt: Date;
}

export interface NatExportFilter {
  states: readonly NatState[];
  protocol?: NatProtocol;
  /** Có giá trị = chỉ giữ rule chạm một cổng trong danh sách (`nat.sensitive_ports`). */
  sensitivePorts?: readonly number[];
  sort?: NatExportSort;
}

function stateOf(rule: NatExportable): NatState {
  if (rule.voidedAt) return 'voided';
  return rule.enabled ? 'open' : 'off';
}

function touches(rule: NatExportable, ports: readonly number[]): boolean {
  return ports.includes(rule.internalPort) || ports.some((port) => port >= rule.externalFrom && port <= rule.externalTo);
}

/**
 * Những rule file xuất mang, theo đúng thứ tự màn đang bày (UX-E29). Luật trùng với màn Sổ NAT
 * (`web/src/features/ipam/nat-buckets.ts`, `nat-sensitive.ts`): màn lọc tại chỗ trên cả sổ,
 * file lọc ở đây trên cùng tập — sửa một bên mà quên bên kia là file nói khác màn.
 */
export function natExportRows<T extends NatExportable>(rows: readonly T[], filter: NatExportFilter): T[] {
  const ip = (rule: T) => rule.internalIp.split('.').reduce((sum, part) => sum * 256 + (Number(part) || 0), 0);
  const byPort = (a: T, b: T) => a.externalFrom - b.externalFrom;
  const compare: Record<NatExportSort, (a: T, b: T) => number> = {
    external: byPort,
    router: (a, b) => (a.deviceCode ?? '').localeCompare(b.deviceCode ?? '') || byPort(a, b),
    internal: (a, b) => ip(a) - ip(b) || byPort(a, b),
    newest: (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || byPort(a, b),
  };
  return rows
    .filter(
      (rule) =>
        filter.states.includes(stateOf(rule)) &&
        (!filter.protocol || rule.protocol === filter.protocol) &&
        (!filter.sensitivePorts || touches(rule, filter.sensitivePorts)),
    )
    .sort(compare[filter.sort ?? 'external']);
}
