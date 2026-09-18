import { describe, expect, it } from 'vitest';
import {
  clampPage,
  countSlots,
  filterSlots,
  nenLocSanDangCap,
  pageSlots,
  slotStatus,
  SLOT_PAGE_SIZE,
} from './slot-paging';
import type { IpStatus, SubnetSlot } from './ipam-types';

/** Ô chưa có hồ sơ — chỉ có địa chỉ, không có hàng nào trong DB. */
function free(address: string): SubnetSlot {
  return { kind: 'free', address };
}

/** Ô đã có hồ sơ, mang một trạng thái vòng đời. */
function record(address: string, status: IpStatus): SubnetSlot {
  return {
    kind: 'record',
    id: `id-${address}`,
    subnetId: 'sub-1',
    address,
    deviceId: null,
    deviceCode: null,
    deviceName: null,
    usedBy: null,
    assignedBy: 'e2e',
    assignedAt: null,
    status,
    note: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  };
}

/** Dải giả n ô liên tiếp — dùng để kiểm cắt trang mà không phải gõ tay 254 dòng. */
function hosts(count: number): SubnetSlot[] {
  return Array.from({ length: count }, (_, i) => free(`10.0.0.${i + 1}`));
}

describe('slotStatus — ô chưa có hồ sơ và hồ sơ trạng thái free đọc như nhau', () => {
  const cases: { name: string; slot: SubnetSlot; expected: IpStatus }[] = [
    { name: 'ô trống chưa có hồ sơ', slot: free('10.0.0.9'), expected: 'free' },
    { name: 'hồ sơ đang dùng', slot: record('10.0.0.1', 'assigned'), expected: 'assigned' },
    { name: 'hồ sơ nghi chết', slot: record('10.0.0.2', 'suspect_dead'), expected: 'suspect_dead' },
    { name: 'hồ sơ đã thu hồi', slot: record('10.0.0.3', 'reclaimed'), expected: 'reclaimed' },
    // Hồ sơ CÓ trong DB nhưng trạng thái free: với người đọc vẫn là "chỗ này trống".
    { name: 'hồ sơ trạng thái trống', slot: record('10.0.0.4', 'free'), expected: 'free' },
  ];

  for (const { name, slot, expected } of cases) {
    it(name, () => {
      expect(slotStatus(slot)).toBe(expected);
    });
  }
});

describe('countSlots + filterSlots — con số trên nút phải khớp số dòng bấm ra', () => {
  const slots: SubnetSlot[] = [
    record('10.0.0.1', 'assigned'),
    record('10.0.0.2', 'assigned'),
    record('10.0.0.3', 'suspect_dead'),
    record('10.0.0.4', 'reclaimed'),
    record('10.0.0.5', 'free'),
    free('10.0.0.6'),
    free('10.0.0.7'),
  ];

  it('đếm đủ năm nhóm, "tất cả" bằng tổng', () => {
    expect(countSlots(slots)).toEqual({
      all: 7,
      assigned: 2,
      free: 3,
      suspect_dead: 1,
      reclaimed: 1,
    });
  });

  it('mỗi con số đếm được phải bằng đúng số dòng lọc ra', () => {
    const counts = countSlots(slots);
    for (const filter of ['all', 'assigned', 'free', 'suspect_dead', 'reclaimed'] as const) {
      expect(filterSlots(slots, filter)).toHaveLength(counts[filter]);
    }
  });

  it('danh sách rỗng thì mọi nhóm là 0, không phải undefined', () => {
    expect(countSlots([])).toEqual({
      all: 0,
      assigned: 0,
      free: 0,
      suspect_dead: 0,
      reclaimed: 0,
    });
  });
});

describe('clampPage — đổi bộ lọc không được rơi vào trang rỗng', () => {
  const cases: { name: string; page: number; total: number; expected: number }[] = [
    { name: 'trang trong khoảng thì giữ nguyên', page: 2, total: 254, expected: 2 },
    { name: 'trang cuối vừa khít', page: 6, total: 254, expected: 6 },
    // 254 host / 50 = 6 trang; xin trang 7 là quá tay.
    { name: 'trang vượt quá bị kéo về trang cuối', page: 7, total: 254, expected: 6 },
    // Đang ở trang 5 rồi lọc còn 3 dòng — chỗ sinh ra bảng rỗng oan.
    { name: 'lọc xong còn ít dòng thì về trang 1', page: 5, total: 3, expected: 1 },
    { name: 'danh sách rỗng vẫn là trang 1', page: 3, total: 0, expected: 1 },
    { name: 'trang 0 hoặc âm bị kéo lên 1', page: 0, total: 100, expected: 1 },
    { name: 'trang âm bị kéo lên 1', page: -4, total: 100, expected: 1 },
  ];

  for (const { name, page, total, expected } of cases) {
    it(name, () => {
      expect(clampPage(page, total)).toBe(expected);
    });
  }
});

describe('pageSlots — cắt đúng 50 dòng một trang', () => {
  it('trang đầu lấy 50 dòng đầu', () => {
    const rows = pageSlots(hosts(254), 1);
    expect(rows).toHaveLength(SLOT_PAGE_SIZE);
    expect(rows[0]).toEqual(free('10.0.0.1'));
    expect(rows[49]).toEqual(free('10.0.0.50'));
  });

  it('trang cuối của /24 chỉ còn 4 dòng', () => {
    const rows = pageSlots(hosts(254), 6);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(free('10.0.0.251'));
  });

  it('trang vượt khoảng trả về trang cuối chứ không trả rỗng', () => {
    expect(pageSlots(hosts(254), 99)).toHaveLength(4);
  });

  it('dải nhỏ hơn một trang thì trả hết trong một trang', () => {
    expect(pageSlots(hosts(12), 1)).toHaveLength(12);
  });
});

/**
 * Luật "có nên tự mở sẵn bộ lọc Đang cấp không" — bốn ca biên quanh hai ngưỡng.
 *
 * Trước 18/09 luật này là một biểu thức viết thẳng trong JSX của `subnet-detail.tsx`, nên
 * không có đường nào hỏi nó mà không dựng cả màn hình lên. Cả hai vế phải THỎA, và mỗi vế
 * chặn một kiểu chọn-hộ-sai — xem chú thích ở `slot-paging.ts`.
 */
describe('nenLocSanDangCap', () => {
  const ca: [string, number, number, boolean][] = [
    ['dưới ngưỡng hồ sơ: /24 mới cấp 4 địa chỉ → đừng giấu ô trống đi', 4, 33, false],
    ['đúng sàn ô trống (32) thì vẫn KHÔNG lọc: cả dải còn lọt một trang', 5, 32, false],
    ['vừa đủ cả hai vế → lọc', 5, 33, true],
    ['/24 dùng thật: 12 hồ sơ nằm rải trong 242 ô trống → lọc', 12, 242, true],
    ['dải /27 đã dùng nhiều nhưng nhỏ → không lọc, mắt tự quét được', 20, 10, false],
    ['dải rỗng hoàn toàn → không có gì đang bị chôn', 0, 254, false],
  ];

  // `oTrong` chứ không phải `free`: tên sau trùng hàm dựng ô trống ở đầu file, và che nó đi
  // trong cả vòng lặp — bài sau thêm vào đây sẽ gọi `free('10.0.0.1')` rồi nhận một con số.
  for (const [ten, assigned, oTrong, mongDoi] of ca) {
    it(ten, () => {
      expect(nenLocSanDangCap(assigned, oTrong)).toBe(mongDoi);
    });
  }
});
