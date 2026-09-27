import { ExpirySourceRegistry } from './expiry-registry';
import type { ExpiryItem, ExpirySource } from './expiry-source';

function item(id: string, kind: string, end: string): ExpiryItem {
  return { id, label: id, kind, start: null, end, link: `/${kind}/${id}` };
}

function source(
  kind: string,
  items: ExpiryItem[],
  options: { canRenew?: boolean; throws?: boolean } = {},
): ExpirySource {
  return {
    sourceKind: kind,
    sourceLabel: `Nguồn ${kind}`,
    findExpiring: () => {
      if (options.throws) throw new Error('nguồn hỏng');
      return Promise.resolve(items);
    },
    ...(options.canRenew ? { renew: () => Promise.resolve() } : {}),
  };
}

describe('ExpirySourceRegistry — engine không biết bảng nào tồn tại (AD-7)', () => {
  it('chưa nguồn nào đăng ký → không có gì, màn vẫn mở được', async () => {
    const registry = new ExpirySourceRegistry();
    expect(registry.list()).toEqual([]);
    await expect(registry.collect('2026-01-01', '2026-12-31')).resolves.toEqual({
      items: [],
      failed: [],
    });
  });

  it('gom mọi nguồn và SẮP THEO NGÀY HẾT HẠN — thứ gấp nhất nằm trên', async () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    registry.register(source('license', [item('lic-1', 'license', '2026-08-25')]));
    registry.register(source('isp', [item('isp-1', 'isp', '2026-12-01')]));

    const { items } = await registry.collect('2026-01-01', '2026-12-31');
    expect(items.map((row) => row.id)).toEqual(['lic-1', 'ssl-1', 'isp-1']);
  });

  it('lọc theo loại chỉ hỏi đúng nguồn đó', async () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    registry.register(source('license', [item('lic-1', 'license', '2026-08-25')]));

    const { items } = await registry.collect('2026-01-01', '2026-12-31', ['ssl']);
    expect(items.map((row) => row.id)).toEqual(['ssl-1']);
  });

  /**
   * Màn cảnh báo hạn mà sập vì một module phụ thì đúng thứ nó sinh ra để chống lại xảy ra, nên
   * phần còn lại vẫn trả về. Nhưng nguồn hỏng phải được NÊU TÊN: nuốt im lặng thì digest tưởng
   * kỳ này không có gì và chốt kỳ, lời nhắc của cả tuần mất theo (BE-01).
   */
  it.each([
    [['vault'], ['lic-1', 'ssl-1']],
    [['vault', 'ssl'], ['lic-1']],
    [[], ['lic-1', 'ssl-1', 'vault-1']],
  ])('nguồn hỏng %j → vẫn trả %j và nêu tên nguồn hỏng', async (broken, ids) => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('vault', [item('vault-1', 'vault', '2026-10-01')], { throws: broken.includes('vault') }));
    registry.register(source('license', [item('lic-1', 'license', '2026-08-25')]));
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')], { throws: broken.includes('ssl') }));

    const { items, failed } = await registry.collect('2026-01-01', '2026-12-31');
    expect(items.map((row) => row.id)).toEqual(ids);
    expect(failed.slice().sort()).toEqual(broken.slice().sort());
  });

  it('đăng ký hai lần cùng một loại không nhân đôi kết quả', async () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    const { items } = await registry.collect('2026-01-01', '2026-12-31');
    expect(items).toHaveLength(1);
  });

  it('nói rõ nguồn nào gia hạn được — bảo hành thiết bị thì không', () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('license', [], { canRenew: true }));
    registry.register(source('warranty', []));
    expect(registry.list()).toEqual([
      { kind: 'license', label: 'Nguồn license', canRenew: true },
      { kind: 'warranty', label: 'Nguồn warranty', canRenew: false },
    ]);
  });
});
