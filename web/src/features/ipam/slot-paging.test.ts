import { describe, expect, it } from 'vitest';
import {
  countSlots,
  filterSlots,
  nextFreeSlot,
  freeChoices,
  shouldIsolateAssigned,
  pageSlots,
  pageOfAddress,
  searchSlots,
  slotStatus,
  SLOT_FILTERS,
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
    // Hồ sơ CÓ trong DB nhưng trạng thái free: với người đọc vẫn là "chỗ này trống".
    { name: 'hồ sơ trạng thái trống', slot: record('10.0.0.4', 'free'), expected: 'free' },
  ];

  for (const { name, slot, expected } of cases) {
    it(name, () => {
      expect(slotStatus(slot)).toBe(expected);
    });
  }
});

describe('SLOT_FILTERS — chip lọc theo hai trạng thái (Q-02)', () => {
  it('chỉ có Tất cả · Đang dùng · Trống', () => {
    expect(SLOT_FILTERS).toEqual(['all', 'assigned', 'free']);
  });
});

describe('countSlots + filterSlots — con số trên nút phải khớp số dòng bấm ra', () => {
  const slots: SubnetSlot[] = [
    record('10.0.0.1', 'assigned'),
    record('10.0.0.2', 'assigned'),
    record('10.0.0.5', 'free'),
    free('10.0.0.6'),
    free('10.0.0.7'),
  ];

  it('đếm đủ bốn nhóm, "tất cả" bằng tổng', () => {
    expect(countSlots(slots)).toEqual({
      all: 5,
      assigned: 2,
      free: 3,
      // `toEqual` trên cả vật thể là có chủ ý: thêm một rổ mà quên khai ở đây thì bài này
      // đỏ, thay vì để một rổ mới lặng lẽ không ai kiểm.
      voided: 0,
    });
  });

  it('mỗi con số đếm được phải bằng đúng số dòng lọc ra', () => {
    const counts = countSlots(slots);
    for (const filter of ['all', 'assigned', 'free', 'voided'] as const) {
      expect(filterSlots(slots, filter)).toHaveLength(counts[filter]);
    }
  });

  it('danh sách rỗng thì mọi nhóm là 0, không phải undefined', () => {
    expect(countSlots([])).toEqual({
      all: 0,
      assigned: 0,
      free: 0,
      voided: 0,
    });
  });
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
 * Luật "có nên tự mở sẵn bộ lọc Đang dùng không" — bốn ca biên quanh hai ngưỡng.
 *
 * Luật là hàm thuần nên hỏi được mà không dựng cả màn hình lên. Cả hai vế phải THỎA, và mỗi
 * vế chặn một kiểu chọn-hộ-sai — xem chú thích ở `slot-paging.ts`.
 */
describe('shouldIsolateAssigned', () => {
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
      expect(shouldIsolateAssigned(assigned, oTrong)).toBe(mongDoi);
    });
  }
});

/**
 * HỒ SƠ ĐÃ ẨN LÀ MỘT RỔ RIÊNG, KHÔNG PHẢI "TRỐNG".
 *
 * Hồ sơ bị ẩn giữ nguyên `status` cũ, phần lớn là `'free'`. Đếm nó vào "Trống" thì thẻ dải nói
 * "còn hồ sơ mang lịch sử" trong khi bảng bảo ô đó trống, cấp được — và ai đó sẽ cấp đè lên
 * một địa chỉ đang mang lịch sử.
 *
 * Sửa ở `slotStatus` vì đó là chỗ duy nhất bộ lọc, con số đếm và bảng cùng hỏi: vá ở
 * `countSlots` thôi thì con số đúng mà bộ lọc vẫn sai, và ngược lại.
 */
describe('slotStatus — hồ sơ đã ẩn không đội lốt "trống"', () => {
  function daAn(address: string, status: IpStatus): SubnetSlot {
    return { ...(record(address, status) as Extract<SubnetSlot, { kind: 'record' }>), voidedAt: '2026-09-01T00:00:00Z' };
  }

  it('hồ sơ đã ẩn mang trạng thái free vẫn KHÔNG phải "trống"', () => {
    expect(slotStatus(daAn('10.0.0.5', 'free'))).toBe('voided');
  });

  it('ẩn thắng cả trạng thái vòng đời khác', () => {
    // `voided_at` là một tầng khác `status`: một hồ sơ đang dùng rồi bị ẩn thì thứ người dùng
    // cần biết trước hết là nó đã bị ẩn.
    expect(slotStatus(daAn('10.0.0.6', 'assigned'))).toBe('voided');
  });

  it('countSlots tách hẳn rổ "đã ẩn" ra khỏi "trống"', () => {
    const slots = [free('10.0.0.1'), record('10.0.0.2', 'free'), daAn('10.0.0.3', 'free')];
    const counts = countSlots(slots);
    expect(counts.free).toBe(2);
    expect(counts.voided).toBe(1);
    // "Tất cả" vẫn là tất cả — rổ mới không được rơi ra ngoài tổng.
    expect(counts.all).toBe(3);
  });

  it('lọc "Trống" KHÔNG kéo theo hồ sơ đã ẩn', () => {
    const anRoi = daAn('10.0.0.3', 'free');
    const slots = [free('10.0.0.1'), record('10.0.0.2', 'free'), anRoi];
    expect(filterSlots(slots, 'free')).not.toContain(anRoi);
    expect(filterSlots(slots, 'voided')).toEqual([anRoi]);
  });

  it('tổng các rổ đúng bằng "Tất cả" (vế đối chứng)', () => {
    /*
     * Ô này bắt đúng cái lỗi mà một bản vá ẩu sẽ gây ra: loại hồ sơ đã ẩn khỏi `free` nhưng
     * quên cho nó một rổ, thì nó biến mất khỏi mọi bộ lọc và người dùng không còn đường nào
     * nhìn thấy nó — tệ hơn hiện trạng, vì hiện trạng ít nhất còn hiện ra (dù sai chỗ).
     */
    const slots = [
      free('10.0.0.1'),
      record('10.0.0.2', 'assigned'),
      daAn('10.0.0.4', 'free'),
      daAn('10.0.0.5', 'assigned'),
    ];
    const counts = countSlots(slots);
    const tong = counts.assigned + counts.free + counts.voided;
    expect(tong).toBe(counts.all);
  });
});

describe('searchSlots — ô tìm ngay trên bảng IP (lọc tại chỗ, cả dải đã trong bộ nhớ)', () => {
  const owned = (address: string, extra: Partial<Extract<SubnetSlot, { kind: 'record' }>>) =>
    ({ ...record(address, 'assigned'), ...extra }) as SubnetSlot;
  const slots: SubnetSlot[] = [
    owned('10.77.1.5', { deviceCode: 'SV-E2E-FILE-01', deviceName: 'Máy chủ file' }),
    owned('10.77.1.53', { usedBy: 'Chị Bình — Kế toán' }),
    free('10.77.1.54'),
    owned('10.77.1.60', { note: 'camera cổng sau' }),
  ];
  const addresses = (q: string) => searchSlots(slots, q).map((s) => s.address);

  it('rỗng → không lọc', () => {
    expect(addresses('  ')).toHaveLength(4);
  });
  it('theo địa chỉ, kể cả ô trống', () => {
    expect(addresses('1.5')).toEqual(['10.77.1.5', '10.77.1.53', '10.77.1.54']);
  });
  it('theo mã máy và tên máy, không phân biệt hoa thường', () => {
    expect(addresses('file-01')).toEqual(['10.77.1.5']);
    expect(addresses('may chu')).toEqual(['10.77.1.5']);
  });
  it('theo người dùng và ghi chú, gõ không dấu', () => {
    expect(addresses('chi binh')).toEqual(['10.77.1.53']);
    expect(addresses('cong sau')).toEqual(['10.77.1.60']);
  });
});

describe('pageOfAddress — nhảy đúng trang chứa IP cần tra', () => {
  const many = Array.from({ length: 120 }, (_, i) => free(`10.0.0.${i + 1}`));
  it.each([
    ['10.0.0.1', 1],
    ['10.0.0.50', 1],
    ['10.0.0.51', 2],
    ['10.0.0.120', 3],
    ['10.9.9.9', null],
  ])('%s → trang %s', (address, page) => {
    expect(pageOfAddress(many, address)).toBe(page);
  });
});

describe('nextFreeSlot — "Cấp IP trống kế tiếp"', () => {
  const voided = { ...record('10.0.0.3', 'free'), voidedAt: '2026-01-02T00:00:00Z' } as SubnetSlot;
  it.each<[string, SubnetSlot[], string | null, string | null]>([
    ['ô trống đầu tiên', [record('10.0.0.1', 'assigned'), free('10.0.0.2')], null, '10.0.0.2'],
    ['bỏ qua gateway', [free('10.0.0.1'), free('10.0.0.2')], '10.0.0.1', '10.0.0.2'],
    ['hồ sơ đã thu hồi cũng là chỗ trống', [record('10.0.0.1', 'free'), free('10.0.0.2')], null, '10.0.0.1'],
    ['hồ sơ đã ẩn KHÔNG phải chỗ trống', [voided, free('10.0.0.4')], null, '10.0.0.4'],
    ['đầy', [record('10.0.0.1', 'assigned')], null, null],
    ['chỉ còn gateway', [free('10.0.0.1')], '10.0.0.1', null],
  ])('%s', (_name, slots, gateway, expected) => {
    expect(nextFreeSlot(slots, gateway)?.address ?? null).toBe(expected);
  });

  it('trả kèm hồ sơ đang Trống để cấp lại đúng hồ sơ đó', () => {
    const hit = nextFreeSlot([record('10.0.0.1', 'free')], null);
    expect(hit?.record?.id).toBe('id-10.0.0.1');
    expect(nextFreeSlot([free('10.0.0.9')], null)?.record).toBeNull();
  });
});

describe('freeChoices — ô chọn địa chỉ trong hộp Cấp IP', () => {
  it('mọi chỗ trống theo thứ tự, bỏ gateway và hồ sơ đã ẩn, giữ hồ sơ Trống kèm bản ghi', () => {
    const voided = { ...record('10.0.0.3', 'free'), voidedAt: '2026-01-02T00:00:00Z' } as SubnetSlot;
    const choices = freeChoices(
      [
        free('10.0.0.1'),
        record('10.0.0.2', 'assigned'),
        voided,
        record('10.0.0.4', 'free'),
        free('10.0.0.5'),
      ],
      '10.0.0.1',
    );
    expect(choices.map((c) => c.address)).toEqual(['10.0.0.4', '10.0.0.5']);
    expect(choices[0].record?.id).toBe('id-10.0.0.4');
    expect(choices[1].record).toBeNull();
  });
});
