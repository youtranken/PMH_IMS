import type { FeatureHolding } from './features';
import { FeatureHolderRegistry, type FeatureHolderSource } from './feature-holders.registry';

function sourceFor(features: FeatureHolderSource['features'], rows: FeatureHolding[] = []): FeatureHolderSource {
  return { features, holdings: () => Promise.resolve(rows) };
}

describe('FeatureHolderRegistry (Q-31)', () => {
  it('không ai đăng ký phiếu ISO → api không khởi động', () => {
    expect(() => new FeatureHolderRegistry().onApplicationBootstrap()).toThrow(/iso_0203|iso_0208/);
  });

  it('đăng ký thiếu một phiếu → nêu đích danh phiếu còn thiếu', () => {
    const registry = new FeatureHolderRegistry();
    registry.register(sourceFor(['iso_0203']));
    expect(() => registry.onApplicationBootstrap()).toThrow(/iso_0208/);
  });

  it('đăng ký đủ → khởi động bình thường', () => {
    const registry = new FeatureHolderRegistry();
    registry.register(sourceFor(['iso_0203', 'iso_0208']));
    expect(() => registry.onApplicationBootstrap()).not.toThrow();
  });

  it('gom việc của mọi nguồn, đăng ký hai lần không đếm đôi', async () => {
    const registry = new FeatureHolderRegistry();
    const iso = sourceFor(['iso_0203', 'iso_0208'], [{ userId: 'an', feature: 'iso_0203', label: '0203' }]);
    registry.register(iso);
    registry.register(iso);
    registry.register(sourceFor(['network'], [{ userId: 'binh', feature: 'network', label: 'sơ đồ' }]));
    await expect(registry.holdings(['an', 'binh'])).resolves.toEqual([
      { userId: 'an', feature: 'iso_0203', label: '0203' },
      { userId: 'binh', feature: 'network', label: 'sơ đồ' },
    ]);
  });
});
