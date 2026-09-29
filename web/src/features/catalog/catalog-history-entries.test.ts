import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { toCatalogHistory, type CatalogHistoryRow } from './catalog-history-entries';

const t = i18n.t;

function row(over: Partial<CatalogHistoryRow>): CatalogHistoryRow {
  return {
    id: '1',
    entity: 'site',
    entityId: 'e1',
    action: 'updated',
    actor: 'it01@pmh.com.vn',
    changes: null,
    createdAt: '2026-09-20T02:00:00Z',
    ...over,
  };
}

describe('toCatalogHistory — sổ danh mục có hình dạng riêng, không phải {field: {before, after}}', () => {
  it('lượt sửa lưu {before, after} phẳng → chỉ đọc các trường đã đổi', () => {
    const [entry] = toCatalogHistory(
      [
        row({
          changes: {
            before: { address: 'Tầng 1' },
            after: { code: 'HCM', name: 'Hồ Chí Minh', address: 'Tầng 2' },
          },
        }),
      ],
      t,
    );
    expect(entry.action).toBe('Sửa');
    expect(entry.detail).toBe('địa chỉ: Tầng 1 → Tầng 2');
  });

  it('lượt tạo không in lại cả hồ sơ, chỉ nói ai tạo lúc nào', () => {
    const [entry] = toCatalogHistory(
      [row({ action: 'created', changes: { code: 'HCM', name: 'Hồ Chí Minh' } })],
      t,
    );
    expect(entry.action).toBe('Tạo mục');
    expect(entry.detail).toBeNull();
    expect(entry.actor).toBe('it01@pmh.com.vn');
  });

  it('bật/tắt và cờ boolean đọc bằng chữ, không phải true/false', () => {
    const [off, flag] = toCatalogHistory(
      [
        row({ action: 'deactivated', changes: {} }),
        row({
          id: '2',
          changes: { before: { hasPortMap: false }, after: { hasPortMap: true } },
        }),
      ],
      t,
    );
    expect(off.action).toBe('Ngừng dùng');
    expect(flag.detail).toBe('có port map: Không → Có');
  });

  it('đổi "Thuộc site" đọc bằng mã + tên site, không phải UUID thô', () => {
    const sites = [
      { id: 'a1b2c3d4-0000-4000-8000-000000000001', code: 'HCM', name: 'Hồ Chí Minh' },
      { id: 'a1b2c3d4-0000-4000-8000-000000000002', code: 'HN', name: 'Hà Nội' },
    ];
    const [entry] = toCatalogHistory(
      [
        row({
          entity: 'cabinet',
          changes: {
            before: { siteId: sites[0].id },
            after: { code: 'RACK-01', siteId: sites[1].id },
          },
        }),
      ],
      t,
      sites,
    );
    expect(entry.detail).toBe('site: HCM — Hồ Chí Minh → HN — Hà Nội');
    expect(entry.detail).not.toContain('a1b2c3d4');
  });

  it('site không còn trong danh mục (hoặc chưa tải xong) thì chỉ nói "đổi site", không in UUID', () => {
    const [entry] = toCatalogHistory(
      [
        row({
          entity: 'cabinet',
          changes: { before: { siteId: 'x-old' }, after: { siteId: 'x-new' } },
        }),
      ],
      t,
    );
    expect(entry.detail).toBe('đổi site');
  });

  it('mã lạ vẫn hiện ra (fallback về mã) thay vì dòng trống', () => {
    const [entry] = toCatalogHistory([row({ action: 'merged', changes: null })], t);
    expect(entry.action).toBe('merged');
  });
});
