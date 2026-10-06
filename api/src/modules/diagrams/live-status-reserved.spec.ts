import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PATH_METADATA } from '@nestjs/common/constants';

/**
 * FR-049 / AD-18 "chừa chỗ trạng thái sống — CHỈ thiết kế": hợp đồng `POST /api/v1/device-status`
 * nằm trong `docs/THIET-KE-TRANG-THAI-SONG.md`, nhưng Epic 10 không mở cửa nào nhận trạng thái.
 * Một route như thế mà lọt vào (dù chỉ là bản nháp) là một đường ghi vào kho không qua phiên người
 * dùng — nên bề mặt route của CẢ ứng dụng được quét, không chỉ module `diagrams`.
 */
function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

function routesOf(file: string): string[] {
  // Nạp động mọi controller tìm thấy trên đĩa: danh sách import viết tay sẽ hụt controller mới.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const exported = require(file) as Record<string, unknown>;
  const out: string[] = [];
  for (const value of Object.values(exported)) {
    if (typeof value !== 'function') continue;
    const base = Reflect.getMetadata(PATH_METADATA, value) as string | string[] | undefined;
    if (base === undefined) continue;
    const bases = Array.isArray(base) ? base : [base];
    const proto = (value as { prototype: Record<string, unknown> }).prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue;
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      if (path === undefined) continue;
      for (const b of bases) for (const p of Array.isArray(path) ? path : [path]) out.push(`${b}/${p}`.replace(/\/+/g, '/'));
    }
  }
  return out;
}

describe('trạng thái sống: chỉ thiết kế, không có route (FR-049, AD-18)', () => {
  const routes = controllerFiles(join(__dirname, '..')).flatMap(routesOf);

  it('đọc được bề mặt route của cả ứng dụng (chống quét hụt)', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes).toContain('api/v1/diagrams/:id/content');
  });

  it('không route nào nhận trạng thái thiết bị', () => {
    expect(routes.filter((r) => /device-status|live-status|trang-thai-song/i.test(r))).toEqual([]);
  });
});
