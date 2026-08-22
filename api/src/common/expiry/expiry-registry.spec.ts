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
    await expect(registry.collect('2026-01-01', '2026-12-31')).resolves.toEqual([]);
  });

  it('gom mọi nguồn và SẮP THEO NGÀY HẾT HẠN — thứ gấp nhất nằm trên', async () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    registry.register(source('license', [item('lic-1', 'license', '2026-08-25')]));
    registry.register(source('isp', [item('isp-1', 'isp', '2026-12-01')]));

    const rows = await registry.collect('2026-01-01', '2026-12-31');
    expect(rows.map((row) => row.id)).toEqual(['lic-1', 'ssl-1', 'isp-1']);
  });

  it('lọc theo loại chỉ hỏi đúng nguồn đó', async () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    registry.register(source('license', [item('lic-1', 'license', '2026-08-25')]));

    const rows = await registry.collect('2026-01-01', '2026-12-31', ['ssl']);
    expect(rows.map((row) => row.id)).toEqual(['ssl-1']);
  });

  /**
   * Màn cảnh báo hạn mà sập vì một module phụ thì đúng thứ nó sinh ra để chống
   * (hết hạn bất ngờ) lại xảy ra.
   */
  it('một nguồn ném lỗi chỉ mất phần của nguồn đó, phần còn lại vẫn hiện', async () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('vault', [], { throws: true }));
    registry.register(source('license', [item('lic-1', 'license', '2026-08-25')]));

    const rows = await registry.collect('2026-01-01', '2026-12-31');
    expect(rows.map((row) => row.id)).toEqual(['lic-1']);
  });

  it('đăng ký hai lần cùng một loại không nhân đôi kết quả', async () => {
    const registry = new ExpirySourceRegistry();
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    registry.register(source('ssl', [item('ssl-1', 'ssl', '2026-09-30')]));
    await expect(registry.collect('2026-01-01', '2026-12-31')).resolves.toHaveLength(1);
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
