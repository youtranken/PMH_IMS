import { BadRequestException } from '@nestjs/common';

/**
 * Truy cập quản trị của thiết bị (Q-26): mỗi dòng một kiểu + địa chỉ (+ cổng). Chỉ là đường vào —
 * mật khẩu vẫn ở Két, không có ô mật khẩu ở đây.
 */
export const ACCESS_KINDS = ['web', 'ssh', 'telnet', 'rdp', 'winbox', 'other'] as const;
export type AccessKind = (typeof ACCESS_KINDS)[number];

export interface AccessPoint {
  kind: AccessKind;
  address: string;
  port: number | null;
}

export const ACCESS_MAX = 10;

/**
 * Tên máy / IPv4 / IPv6 trong ngoặc vuông, có thể kèm `user@`. Địa chỉ SSH/Telnet đi vào lệnh người
 * dùng CHÉP RA TERMINAL: không được mở đầu bằng `-` (tuỳ chọn như `-oProxyCommand=`) hay chứa ký tự
 * shell (`;`, `$`, `|`, `` ` ``…). Cùng luật `SHELL_SAFE` của web (`accessView`).
 */
const HOST = /^(?:[A-Za-z0-9._-]+@)?(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])$/;
/** Web: URL http(s) hoặc tên máy / IP (kèm đường dẫn) — scheme khác không thành link được. */
const WEB = /^(?:https?:\/\/[^\s<>"']+|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d+)?(?:\/[^\s<>"']*)?|\[[0-9A-Fa-f:.]+\](?::\d+)?(?:\/[^\s<>"']*)?)$/i;

/** Đầu vào thô → danh sách sạch; dòng chưa có địa chỉ bị bỏ (form để trống một dòng). */
export function normalizeAccessPoints(input: unknown): AccessPoint[] {
  if (!Array.isArray(input)) throw invalid('Truy cập quản trị phải là danh sách các dòng.');
  const out: AccessPoint[] = [];
  for (const raw of input as Record<string, unknown>[]) {
    const address = typeof raw?.address === 'string' ? raw.address.trim() : '';
    if (!address) continue;
    if (!ACCESS_KINDS.includes(raw.kind as AccessKind)) throw invalid(`Kiểu truy cập phải là một trong: Web, SSH, Telnet, RDP, Winbox, Khác.`);
    // Địa chỉ đi thẳng vào link / lệnh SSH: không khoảng trắng, không quá dài.
    if (address.length > 200 || /\s/.test(address)) throw invalid(`Địa chỉ "${address.slice(0, 40)}" không hợp lệ — tối đa 200 ký tự, không khoảng trắng.`);
    const kind = raw.kind as AccessKind;
    if (address.startsWith('-')) throw invalid(`Địa chỉ "${address.slice(0, 40)}" không được mở đầu bằng dấu gạch.`);
    if (kind === 'web' && !WEB.test(address)) throw invalid(`Địa chỉ Web "${address.slice(0, 40)}" phải là http(s)://… hoặc tên máy / IP.`);
    if ((kind === 'ssh' || kind === 'telnet' || kind === 'rdp' || kind === 'winbox') && !HOST.test(address)) {
      throw invalid(`Địa chỉ "${address.slice(0, 40)}" phải là tên máy hoặc IP (có thể kèm user@), không chứa ký tự đặc biệt.`);
    }
    const port = raw.port === undefined || raw.port === null || raw.port === '' ? null : Number(raw.port);
    if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw invalid('Cổng phải là số từ 1 đến 65535.');
    out.push({ kind: raw.kind as AccessKind, address, port });
  }
  if (out.length > ACCESS_MAX) throw invalid(`Tối đa ${ACCESS_MAX} dòng truy cập cho một thiết bị.`);
  return out;
}

const KIND_LABEL: Record<AccessKind, string> = { web: 'Web', ssh: 'SSH', telnet: 'Telnet', rdp: 'RDP', winbox: 'Winbox', other: 'Khác' };

/** Một dòng chữ cho lịch sử thiết bị: "Web 10.0.1.1:443; SSH 10.0.1.1:22". */
export function accessSummary(points: readonly AccessPoint[]): string {
  return points.map((p) => `${KIND_LABEL[p.kind]} ${p.address}${p.port ? `:${p.port}` : ''}`).join('; ');
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: 'DEVICE_ACCESS_INVALID', message });
}
