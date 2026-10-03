import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DevicesApiService } from '../devices/devices.api';
import { DiagramsController } from './diagrams.controller';

/**
 * AD-18 / Q-23 "vẽ là khai, có hỏi": sơ đồ cổng chỉ có MỘT đường ghi — endpoint của `devices`, do
 * web gọi sau khi người dùng bấm "Khai" / "Gỡ luôn kết nối". Module `diagrams` không có route nào
 * ghi cổng, và không có cách nào ghi cổng qua public api của `devices`.
 */
describe('diagrams không ghi sơ đồ cổng (bề mặt route + public api)', () => {
  const routes = Object.getOwnPropertyNames(DiagramsController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = (DiagramsController.prototype as unknown as Record<string, () => unknown>)[name];
      return {
        name,
        path: Reflect.getMetadata(PATH_METADATA, handler) as string | undefined,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined,
      };
    })
    .filter((route) => route.path !== undefined);

  it('đọc được bề mặt route (chống regex/metadata hụt)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(15);
  });

  it('không route nào của diagrams chạm "port"', () => {
    expect(routes.filter((r) => /port(?!-map)/i.test(r.path ?? ''))).toEqual([]);
  });

  it('public api của devices chỉ cho ĐỌC dây (portLinks, portLinksTouching) — không có hàm ghi cổng', () => {
    const methods = Object.getOwnPropertyNames(DevicesApiService.prototype).filter((m) => /port|link/i.test(m));
    expect(methods.sort()).toEqual(['portLinks', 'portLinksTouching']);
  });

  it('mã nguồn diagrams không import gì của devices ngoài devices.api (và module để Nest nối DI)', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /from '\.\.\/devices\/(?!devices\.(?:api|module)')/.test(readFileSync(join(dir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
