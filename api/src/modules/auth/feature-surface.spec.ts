import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allControllers, classDecoratorsOf, routesOf } from '../../test/source-text';

const SRC = join(__dirname, '..', '..');
const CONTROLLERS = allControllers(SRC);

function covers(block: string): boolean {
  return block.includes('@Feature(') || block.includes('@FeatureFree()') || block.includes('@Public()');
}

/**
 * Q-31: FeatureGuard mặc định đóng chỉ ở runtime. Bài này bắt route quên khai mảng ngay ở unit,
 * trước khi một Member trên production gặp 403 `FEATURE_NOT_DECLARED`.
 */
describe('Mọi route khai mảng của nhóm quyền (Q-31)', () => {
  it('quét được controller và route', () => {
    expect(CONTROLLERS.length).toBeGreaterThan(10);
  });

  it('MỌI route handler được phủ bởi @Feature(...), @FeatureFree() hoặc @Public()', () => {
    const missing: string[] = [];
    for (const file of CONTROLLERS) {
      const src = readFileSync(file, 'utf8');
      if (covers(classDecoratorsOf(src))) continue;
      for (const route of routesOf(src)) {
        if (!covers(route.decorators)) missing.push(`${file.slice(SRC.length + 1)}:${route.line} ${route.route}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('FeatureGuard đăng ký là APP_GUARD, đứng sau RolesGuard và trước StepUpGuard', () => {
    const appModule = readFileSync(join(SRC, 'app.module.ts'), 'utf8');
    const roles = appModule.search(/APP_GUARD,\s*useClass:\s*RolesGuard/);
    const feature = appModule.search(/APP_GUARD,\s*useClass:\s*FeatureGuard/);
    const stepUp = appModule.search(/APP_GUARD,\s*useClass:\s*StepUpGuard/);
    expect(roles).toBeGreaterThan(-1);
    expect(feature).toBeGreaterThan(roles);
    expect(stepUp).toBeGreaterThan(feature);
  });
});
