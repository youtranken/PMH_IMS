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
    expect(off.action).toBe('Vô hiệu hóa');
    expect(flag.detail).toBe('có port map: Không → Có');
  });

  it('mã lạ vẫn hiện ra (fallback về mã) thay vì dòng trống', () => {
    const [entry] = toCatalogHistory([row({ action: 'merged', changes: null })], t);
    expect(entry.action).toBe('merged');
  });
});
