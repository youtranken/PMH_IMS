/** Một dòng Truy cập quản trị của thiết bị (`device.accessPoints`, Q-26). */
export interface AccessPoint {
  kind: 'web' | 'ssh' | 'telnet' | 'rdp' | 'winbox' | 'other';
  address: string;
  port: number | null;
}

export const ACCESS_KINDS: AccessPoint['kind'][] = ['web', 'ssh', 'telnet', 'rdp', 'winbox', 'other'];

const HTTPS_PORTS = new Set([443, 8443]);

/**
 * Cách hiện một dòng: Web thành link (CHỈ http/https — địa chỉ là chữ người dùng gõ, `javascript:`
 * không bao giờ thành link), SSH/Telnet thành lệnh để chép, còn lại là chữ "địa chỉ:cổng".
 */
export function accessView(point: AccessPoint): { href: string | null; command: string | null; text: string } {
  const text = point.port ? `${point.address}:${point.port}` : point.address;
  if (point.kind === 'web') {
    if (/^https?:\/\//i.test(point.address)) return { href: point.address, command: null, text: point.address };
    if (/^[a-z][a-z0-9+.-]*:/i.test(point.address) && !/^[^:]+:\d+$/.test(point.address)) return { href: null, command: null, text };
    const https = point.port !== null && HTTPS_PORTS.has(point.port);
    const port = point.port && point.port !== 443 && point.port !== 80 ? `:${point.port}` : '';
    return { href: `${https ? 'https' : 'http'}://${point.address}${port}`, command: null, text };
  }
  if (point.kind === 'ssh') return { href: null, command: `ssh ${point.address}${point.port ? ` -p ${point.port}` : ''}`, text };
  if (point.kind === 'telnet') return { href: null, command: `telnet ${point.address}${point.port ? ` ${point.port}` : ''}`, text };
  return { href: null, command: null, text };
}
