import { CatalogUsageRegistry, type CatalogUsageCounter } from './catalog-usage.registry';

function counter(
  entity: string,
  kind: string,
  counts: Record<string, number> | (() => never),
): CatalogUsageCounter {
  return {
    entity,
    kind,
    countFor: () => {
      if (typeof counts === 'function') counts();
      return Promise.resolve(new Map(Object.entries(counts as Record<string, number>)));
    },
  };
}

const REFS = [
  { id: 'a', name: 'Kế toán' },
  { id: 'b', name: 'Kinh doanh' },
];

describe('CatalogUsageRegistry — "đang dùng ở N …" của màn Danh mục', () => {
  it('chưa ai đăng ký → mỗi mục một danh sách rỗng, không ném', async () => {
    const usage = await new CatalogUsageRegistry().usageOf('site', REFS);
    expect(usage.get('a')).toEqual([]);
    expect(usage.get('b')).toEqual([]);
  });

  it('gom số của mọi module đếm cùng loại danh mục, bỏ số 0, không lẫn loại khác', async () => {
    const registry = new CatalogUsageRegistry();
    registry.register(counter('department', 'device', { a: 3 }));
    registry.register(counter('department', 'service_account', { a: 1, b: 2 }));
    registry.register(counter('site', 'device', { a: 99 }));
    const usage = await registry.usageOf('department', REFS);
    expect(usage.get('a')).toEqual([
      { kind: 'device', count: 3 },
      { kind: 'service_account', count: 1 },
    ]);
    expect(usage.get('b')).toEqual([{ kind: 'service_account', count: 2 }]);
  });

  it('đăng ký hai lần cùng (loại, thứ đếm) không nhân đôi con số', async () => {
    const registry = new CatalogUsageRegistry();
    registry.register(counter('site', 'device', { a: 2 }));
    registry.register(counter('site', 'device', { a: 2 }));
    const usage = await registry.usageOf('site', REFS);
    expect(usage.get('a')).toEqual([{ kind: 'device', count: 2 }]);
  });

  it('một module đếm hỏng → thiếu phần của nó, KHÔNG làm sập danh sách danh mục', async () => {
    const registry = new CatalogUsageRegistry();
    registry.register(
      counter('site', 'subnet', () => {
        throw new Error('hỏng');
      }),
    );
    registry.register(counter('site', 'device', { b: 4 }));
    const usage = await registry.usageOf('site', REFS);
    expect(usage.get('a')).toEqual([]);
    expect(usage.get('b')).toEqual([{ kind: 'device', count: 4 }]);
  });

  it('danh sách rỗng thì không hỏi module nào', async () => {
    const registry = new CatalogUsageRegistry();
    const spy = jest.fn(() => Promise.resolve(new Map<string, number>()));
    registry.register({ entity: 'site', kind: 'device', countFor: spy });
    await registry.usageOf('site', []);
    expect(spy).not.toHaveBeenCalled();
  });
});
