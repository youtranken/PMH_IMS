/**
 * Cổng mẫu của model (Q-26) — phép mở mẫu `[a-b]` để XEM TRƯỚC trong hộp model. PHẢI cùng phép với
 * `expandPortTemplate` của api (`api/src/modules/devices/port-template.ts`); server vẫn là trọng tài.
 * Hàm trả MỘT hình dạng `{ ports, error }` (tsconfig web không bật strict).
 */
export const PORT_KINDS = ['rj45', 'sfp', 'sfp+', 'console', 'other'] as const;
export type PortKind = (typeof PORT_KINDS)[number];

export interface PortTemplateGroup {
  pattern: string;
  kind: PortKind;
}

export interface PhysicalPort {
  label: string;
  kind: PortKind;
}

/** Mẫu dựng sẵn để chọn nhanh trong hộp model. */
export const PORT_PRESETS: { key: string; groups: PortTemplateGroup[] }[] = [
  { key: 'switch24', groups: [{ pattern: 'Gi1/0/[1-24]', kind: 'rj45' }] },
  { key: 'switch48', groups: [{ pattern: 'Gi1/0/[1-48]', kind: 'rj45' }, { pattern: 'Te1/1/[1-4]', kind: 'sfp+' }] },
  { key: 'oneLan', groups: [{ pattern: 'LAN', kind: 'rj45' }] },
];

const RANGE = /\[(\d+)-(\d+)\]/g;

export type PortTemplateError = { key: 'twoRanges' | 'reversed' | 'tooMany' | 'duplicate'; value: string } | null;

export function expandPortTemplate(groups: readonly PortTemplateGroup[], max: number): { ports: PhysicalPort[]; error: PortTemplateError } {
  const ports: PhysicalPort[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const pattern = group.pattern.trim();
    if (!pattern) continue;
    const ranges = [...pattern.matchAll(RANGE)];
    if (ranges.length > 1) return { ports: [], error: { key: 'twoRanges', value: pattern } };
    const labels: string[] = [];
    if (ranges.length === 0) {
      labels.push(pattern);
    } else {
      const [whole, a, b] = ranges[0];
      const from = Number(a);
      const to = Number(b);
      if (from > to) return { ports: [], error: { key: 'reversed', value: whole } };
      if (ports.length + (to - from + 1) > max) return { ports: [], error: { key: 'tooMany', value: String(max) } };
      for (let n = from; n <= to; n += 1) labels.push(pattern.replace(whole, String(n)));
    }
    for (const label of labels) {
      const key = label.toLowerCase();
      if (seen.has(key)) return { ports: [], error: { key: 'duplicate', value: label } };
      seen.add(key);
      ports.push({ label, kind: group.kind });
    }
    if (ports.length > max) return { ports: [], error: { key: 'tooMany', value: String(max) } };
  }
  return { ports, error: null };
}
