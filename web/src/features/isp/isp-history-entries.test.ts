import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { liquidationOf, toIspHistory } from './isp-history-entries';
import type { IspHistoryRow } from './isp-types';

/* `t` THẬT của app — xem chú thích ở `software-history-entries.test.ts`. */
const t = i18n.t;

function row(over: Partial<IspHistoryRow>): IspHistoryRow {
  return {
    id: '1',
    action: 'updated',
    actor: 'it01@pmh.com.vn',
    changes: null,
    createdAt: '2026-09-20T02:00:00Z',
    ...over,
  };
}

describe('toIspHistory — Q-04: ba trạng thái Đang dùng / Tạm ngưng / Thanh lý', () => {
  it('đổi sang terminated đọc là một lượt thanh lý, không phải "Sửa hồ sơ"', () => {
    const [entry] = toIspHistory(
      [row({ changes: { status: { before: 'active', after: 'terminated' } } })],
      t,
    );
    expect(entry.action).toBe('Thanh lý đường truyền');
    expect(entry.detail).toBe('trạng thái: Đang dùng → Thanh lý');
  });

  it('tạm ngưng vẫn là một lượt sửa hồ sơ bình thường', () => {
    const [entry] = toIspHistory(
      [row({ changes: { status: { before: 'active', after: 'suspended' } } })],
      t,
    );
    expect(entry.action).toBe('Sửa hồ sơ');
    expect(entry.detail).toBe('trạng thái: Đang dùng → Tạm ngưng');
  });

  it('dòng gia hạn cũ trong sổ vẫn đọc được — lịch sử chỉ thêm, không xoá', () => {
    const [entry] = toIspHistory(
      [row({ action: 'renewed', changes: { endDate: { before: '2026-08-30', after: '2027-08-30' } } })],
      t,
    );
    expect(entry.action).toBe('Gia hạn hợp đồng');
    expect(entry.detail).toBe('ngày hết hạn: 2026-08-30 → 2027-08-30');
  });
});

describe('liquidationOf — ai thanh lý, lúc nào', () => {
  const terminated = row({
    id: 't',
    actor: 'sa@pmh.com.vn',
    createdAt: '2026-09-21T03:00:00Z',
    changes: { status: { before: 'active', after: 'terminated' } },
  });

  it.each<[string, IspHistoryRow[], { at: string; actor: string } | null]>([
    ['sổ rỗng', [], null],
    ['chưa từng đổi trạng thái', [row({ changes: { hotline: { before: null, after: '1800' } } })], null],
    ['lượt thanh lý là lượt đổi trạng thái mới nhất', [
      row({ id: 'n', changes: { note: { before: null, after: 'x' } } }),
      terminated,
    ], { at: '2026-09-21T03:00:00Z', actor: 'sa@pmh.com.vn' }],
    ['thanh lý rồi dùng lại thì không còn là thanh lý', [
      row({ id: 'r', changes: { status: { before: 'terminated', after: 'active' } } }),
      terminated,
    ], null],
  ])('%s', (_label, rows, expected) => {
    expect(liquidationOf(rows)).toEqual(expected);
  });
});
