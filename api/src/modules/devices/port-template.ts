import { BadRequestException } from '@nestjs/common';

/**
 * Cổng mẫu của model và danh sách cổng của từng máy (Q-26). Mẫu gõ theo đúng tên của hãng; `[a-b]`
 * sinh một dải ("Gi1/0/[1-48]" → Gi1/0/1…48). Kiểu cổng để vẽ mặt cổng.
 *
 * Danh sách cổng là CỔNG VẬT LÝ của máy, khác `device_port` (mỗi hàng là MỘT SỢI DÂY): cổng trống
 * không sinh hàng dây nào, nên sơ đồ cổng, file xuất và phép tính dây của sơ đồ không đổi nghĩa.
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

const RANGE = /\[(\d+)-(\d+)\]/g;

/** Mẫu → danh sách cổng; `max` = trần `device.port_template_max`. */
export function expandPortTemplate(groups: unknown, max: number): PhysicalPort[] {
  if (!Array.isArray(groups)) throw invalid('Cổng mẫu phải là danh sách các nhóm.');
  const out: PhysicalPort[] = [];
  for (const raw of groups as Record<string, unknown>[]) {
    const pattern = typeof raw?.pattern === 'string' ? raw.pattern.trim() : '';
    if (!pattern) continue;
    const kind = kindOf(raw.kind);
    const ranges = [...pattern.matchAll(RANGE)];
    if (ranges.length > 1) throw invalid(`Mẫu "${pattern}" chỉ được có một dải [a-b].`);
    if (ranges.length === 0) {
      out.push({ label: pattern, kind });
    } else {
      const [whole, a, b] = ranges[0];
      const from = Number(a);
      const to = Number(b);
      if (from > to) throw invalid(`Dải ${whole} trong "${pattern}" phải từ số nhỏ tới số lớn.`);
      if (out.length + (to - from + 1) > max) throw invalid(`Một máy tối đa ${max} cổng — mẫu này sinh quá nhiều.`);
      for (let n = from; n <= to; n += 1) out.push({ label: pattern.replace(whole, String(n)), kind });
    }
    if (out.length > max) throw invalid(`Một máy tối đa ${max} cổng — mẫu này sinh quá nhiều.`);
  }
  assertUnique(out);
  return out;
}

/** Danh sách cổng gửi lên cho một máy (thêm cổng riêng, bỏ cổng) — làm sạch và kiểm như mẫu. */
export function normalizePortLayout(input: unknown, max: number): PhysicalPort[] {
  if (!Array.isArray(input)) throw invalid('Danh sách cổng phải là một mảng.');
  const out = (input as Record<string, unknown>[])
    .map((raw) => ({ label: typeof raw?.label === 'string' ? raw.label.trim() : '', kind: raw?.kind }))
    .filter((raw) => raw.label)
    .map((raw) => {
      if (raw.label.length > 60) throw invalid(`Tên cổng "${raw.label.slice(0, 30)}…" quá 60 ký tự.`);
      return { label: raw.label, kind: kindOf(raw.kind) };
    });
  if (out.length > max) throw invalid(`Một máy tối đa ${max} cổng.`);
  assertUnique(out);
  return out;
}

/** Một dòng cho lịch sử thiết bị: "52 cổng: Gi1/0/1 … Te1/1/4". */
export function portLayoutSummary(ports: readonly PhysicalPort[]): string {
  if (ports.length === 0) return '';
  const edge = ports.length === 1 ? ports[0].label : `${ports[0].label} … ${ports[ports.length - 1].label}`;
  return `${ports.length} cổng: ${edge}`;
}

function kindOf(value: unknown): PortKind {
  if (!PORT_KINDS.includes(value as PortKind)) throw invalid('Kiểu cổng phải là RJ45, SFP, SFP+, Console hoặc Khác.');
  return value as PortKind;
}

/** Nhãn cổng không phân biệt hoa thường — cùng luật `device_port_label_key` (0041). */
function assertUnique(ports: PhysicalPort[]): void {
  const seen = new Set<string>();
  for (const port of ports) {
    const key = port.label.toLowerCase();
    if (seen.has(key)) throw invalid(`Cổng "${port.label}" bị trùng tên.`);
    seen.add(key);
  }
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'PORT_TEMPLATE_INVALID', message });
}
