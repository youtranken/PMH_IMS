import { ExpiryService } from './expiry.service';
import type { ExpirySourceRegistry } from '../../common/expiry/expiry-registry';
import type { ExpiryItem } from '../../common/expiry/expiry-source';
import type { AuditWriterService } from '../audit/audit-writer.service';
import type { SystemConfigService } from '../config-sys/system-config.service';
import type { Database } from '../../database/database.module';

/**
 * MÀN "SẮP HẾT HẠN" PHẢI PHÂN TRANG Ở MÁY CHỦ (N-01 — mức CHẶN).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `@Get()` của `expiry.controller.ts` không nhận `page`/`limit`, và `expiry-screen.tsx` có
 * `grep -c Pagination` = **0**. Nên mỗi lần mở màn là một lượt trả TRỌN BỘ kết quả của cửa sổ
 * — đo được **7.662 dòng** ở 30k hồ sơ, và ở 200k thì màn **không dùng được**.
 *
 * Hai điều làm nó nặng hơn vẻ ngoài:
 *
 *   1. **Nó tăng theo THỜI GIAN, không theo quy mô đội máy** (§14.5). Cửa sổ nhìn lùi mặc
 *      định là một năm, nên mỗi năm trôi qua rổ "đã quá hạn" lại dày thêm — công ty ngừng mua
 *      máy cũng không làm nó nhỏ lại.
 *   2. **Một màn hỏng làm bẩn cả phiên làm việc.** Sau khi mở `/expiry` một lần, lượt đo
 *      `/nat` ngay sau đó ra 9.730ms; đo lại một mình chỉ 582ms. Trình duyệt còn đang dọn
 *      841k node.
 *
 * ===== CHỖ DỄ VÁ SAI, VÀ BÀI NÀY CANH ĐÚNG CHỖ ĐÓ =====
 *
 * Cắt `items` xuống một trang là phần dễ. Phần dễ sai là `summary` — ba con số "Quá hạn /
 * Gấp / Sắp tới" nằm trên NÚT LỌC ở đầu màn. Nếu chúng đếm trên trang đang xem thì chúng trở
 * thành "có bao nhiêu mục gấp TRONG 50 dòng này" — một câu không ai hỏi, hiển thị ở đúng chỗ
 * người ta đọc câu "có bao nhiêu mục gấp". Sai kiểu đó không làm gì đỏ và không ai báo lỗi;
 * người ta chỉ lặng lẽ tin vào một con số nhỏ hơn sự thật.
 *
 * Nên: `items` là MỘT TRANG, `total` và `summary` là CẢ KHO.
 *
 * ===== PHẠM VI, NÓI THẲNG =====
 *
 * Bản vá này cắt ở tầng engine: `registry.collect()` vẫn hỏi trọn cửa sổ từ mọi nguồn rồi mới
 * sắp và cắt. Nó bỏ được phần đắt nhất đã đo — tuần tự hoá 7.662 bản ghi, đẩy qua dây, và
 * 841k node DOM — nhưng KHÔNG bỏ được chi phí truy vấn ở các nguồn.
 *
 * Cắt tận gốc đòi đổi hợp đồng `ExpirySource.findExpiring(from, to)` cho mọi module đã đăng
 * ký (AD-7), và một phép trộn k-đường có thứ tự giữa các nguồn. Đó là một story riêng, không
 * phải một bản vá — ghi vào mục 8.9 chứ không giả vờ đã xong.
 */

const TODAY = '2026-09-21';

/** `n` mục hết hạn rải đều về phía trước, mục đầu gấp nhất. */
function items(n: number): ExpiryItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `item-${i}`,
    label: `Hồ sơ ${i}`,
    kind: 'license',
    start: null,
    // i = 0 → hôm nay; i = 1 → mai; … luôn tăng dần nên thứ tự sắp xếp đoán trước được.
    end: addDays(TODAY, i),
    link: `/software/${i}`,
  }));
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function serviceWith(all: ExpiryItem[]): ExpiryService {
  const registry = {
    collect: () => Promise.resolve([...all]),
    list: () => [{ kind: 'license', label: 'License', canRenew: true }],
  } as unknown as ExpirySourceRegistry;

  const config = {
    getString: () => Promise.resolve('Asia/Ho_Chi_Minh'),
    getNumber: (name: string) =>
      Promise.resolve(name === 'expiryCriticalDays' ? 7 : 30),
  } as unknown as SystemConfigService;

  const audit = { appendWithin: () => Promise.resolve() } as unknown as AuditWriterService;
  const db = {} as unknown as Database;
  return new ExpiryService(db, registry, audit, config);
}

describe('Màn "Sắp hết hạn" — phân trang máy chủ', () => {
  it('không xin trang nào → vẫn trả trọn bộ (email digest và export dựa vào đây)', async () => {
    const page = await service120().list({ withinDays: 365 });
    expect(page.items).toHaveLength(120);
    expect(page.total).toBe(120);
  });

  it('xin trang 1, limit 50 → đúng 50 dòng, `total` vẫn là 120', async () => {
    const page = await service120().list({ withinDays: 365, page: 1, limit: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(120);
    expect(page.items[0].id).toBe('item-0');
  });

  it('trang 2 nối đúng vào trang 1, không trùng không hụt', async () => {
    const page = await service120().list({ withinDays: 365, page: 2, limit: 50 });
    expect(page.items[0].id).toBe('item-50');
    expect(page.items).toHaveLength(50);
  });

  it('trang cuối chỉ còn phần dư', async () => {
    const page = await service120().list({ withinDays: 365, page: 3, limit: 50 });
    expect(page.items).toHaveLength(20);
    expect(page.items[19].id).toBe('item-119');
  });

  it('xin quá trang cuối → rỗng, KHÔNG quay vòng về trang 1', async () => {
    // Quay vòng là cách hỏng tệ nhất ở đây: người dùng bấm "sau" và thấy lại đúng dòng đầu,
    // rồi kết luận mình đã đọc hết trong khi còn nguyên phần giữa.
    const page = await service120().list({ withinDays: 365, page: 99, limit: 50 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(120);
  });

  it('`summary` đếm CẢ KHO, không đếm mỗi trang đang xem', async () => {
    const page = await service120().list({ withinDays: 365, page: 3, limit: 50 });
    // Trang 3 chỉ có 20 dòng, và tất cả đều ở xa (ngày 100→119). Nhưng ba con số trên nút lọc
    // phải nói về cả 120 mục: 1 hôm nay + 7 trong ngưỡng gấp, 23 còn lại trong ngưỡng vàng.
    expect(page.summary.critical).toBe(8);
    expect(page.summary.warning).toBe(23);
    expect(page.summary.critical + page.summary.warning).toBeGreaterThan(page.items.length);
  });

  it('`thresholds` không đổi theo trang — web dùng nó để tô màu', async () => {
    const first = await service120().list({ withinDays: 365, page: 1, limit: 10 });
    const last = await service120().list({ withinDays: 365, page: 12, limit: 10 });
    expect(first.thresholds).toEqual(last.thresholds);
  });


  /**
   * LỌC THEO NHÓM CŨNG PHẢI Ở MÁY CHỦ — nếu không, bản vá phân trang đẻ ra một lỗi TỆ HƠN.
   *
   * Màn này có ba nút lọc "Quá hạn / Gấp / Sắp tới", và tới 21/09 chúng lọc Ở CLIENT. Chú
   * thích tại chỗ nói rõ vì sao được phép: *"Màn này KHÔNG phân trang — API trả về hết — nên
   * lọc ở đây là lọc đúng toàn bộ tập kết quả, không phải chỉ trang đang xem."*
   *
   * Câu ấy đúng, và nó ngừng đúng ngay khi phân trang. Cắt server mà để nguyên phép lọc client
   * thì bấm "Gấp" chỉ lọc trong 50 dòng đang xem: người trực thấy 3 mục gấp trong khi nút ngay
   * trên đầu đề số 87. Một màn tự mâu thuẫn với chính nó, và nó xuất hiện do BẢN VÁ chứ không
   * do lỗi cũ — nên phép lọc phải đi xuống cùng chuyến.
   *
   * Thứ tự bắt buộc ở server: `summarize` TRƯỚC (cả kho, mọi nhóm) → lọc nhóm → cắt trang.
   * Đảo hai bước đầu thì ba con số trên nút đổi mỗi lần bấm vào chính nó.
   */
  describe('lọc theo nhóm', () => {
    it('`state=critical` chỉ trả mục gấp, và `total` đếm đúng nhóm đó', async () => {
      const page = await service120().list({ withinDays: 365, state: 'critical' });
      expect(page.total).toBe(8);
      expect(page.items.every((r) => r.daysLeft >= 0 && r.daysLeft <= 7)).toBe(true);
    });

    it('ba con số trên nút KHÔNG đổi khi bấm vào một nút', async () => {
      const all = await service120().list({ withinDays: 365 });
      const filtered = await service120().list({ withinDays: 365, state: 'critical' });
      expect(filtered.summary).toEqual(all.summary);
    });

    it('lọc rồi mới cắt trang — không phải cắt rồi mới lọc', async () => {
      // 8 mục gấp, xin trang 1 limit 5 → phải ra 5, và `total` vẫn 8. Nếu cắt trước rồi lọc
      // thì trang 1 (50 dòng đầu) lọc ra 8 và `total` sai thành 8/50 — trông na ná, khác hẳn.
      const page = await service120().list({
        withinDays: 365,
        state: 'critical',
        page: 1,
        limit: 5,
      });
      expect(page.items).toHaveLength(5);
      expect(page.total).toBe(8);
    });

    it('`state` rỗng hoặc vắng → không lọc gì (vế đối chứng)', async () => {
      expect((await service120().list({ withinDays: 365 })).total).toBe(120);
    });
  });

  function service120(): ExpiryService {
    return serviceWith(items(120));
  }
});
