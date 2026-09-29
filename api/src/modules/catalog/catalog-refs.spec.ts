import { CatalogApiService } from './catalog.api';
import type { CatalogService } from './catalog.service';

/**
 * MỘT CÁI TỦ PHẢI ĐỨNG Ở ĐÂU ĐÓ (A-11).
 *
 * ===== LỖ MÀ BÀI NÀY CANH =====
 *
 * `validateRefs` kiểm cặp tủ↔site bằng một câu có điều kiện kép:
 *
 *     } else if (refs.siteId && cabinet.siteId !== refs.siteId) {
 *
 * Vế `refs.siteId &&` ở đầu làm cả phép kiểm BIẾN MẤT khi site trống. Gửi `{"siteId": ""}`
 * lên một thiết bị đang gắn tủ là đi qua cửa trọn vẹn, và hàng ra có `cabinet_id` mà không có
 * `site_id`: không lọc ra được bằng site nào, và trang chi tiết hiện một cái tủ không biết
 * nằm ở đâu.
 *
 * Đường Excel chặn đúng chuyện này (`device-import.ts`), kèm một câu từ chối nói rõ phải làm
 * gì. Cửa HTTP phải chặn y như vậy — hình dạng "cửa Excel được canh, cửa HTTP bỏ ngỏ" cũng là
 * hình dạng của A-03.
 *
 * ===== LUẬT NÀY CÓ CHẶN DỮ LIỆU ĐANG CHẠY KHÔNG =====
 *
 * Đếm trên DB:
 *
 *     SELECT count(*) FROM device WHERE cabinet_id IS NOT NULL AND site_id IS NULL;  -- 0
 *
 * Nhưng nói thẳng giới hạn của con số ấy: nó đếm trên DB dev, nơi lúc đó có đúng MỘT thiết
 * bị. Nó chứng minh được rất ít. Điều thật sự giữ an toàn nằm ở chỗ khác: `validateRefs` chỉ
 * chạy ở đường GHI, nên hàng cũ không bị từ chối chỉ vì nó tồn tại. Người ta chỉ gặp luật này
 * khi SỬA một hồ sơ đã lệch — và lúc đó câu từ chối phải nói rõ hai đường ra, y như bản Excel.
 */

/** Danh mục giả — `validateRefs` chỉ đọc bốn danh sách này, không đụng gì khác. */
const SITE_HA_NOI = 'aaaaaaaa-0000-0000-0000-000000000001';
const SITE_DA_NANG = 'aaaaaaaa-0000-0000-0000-000000000002';
const CABINET_A1 = 'bbbbbbbb-0000-0000-0000-000000000001';

function apiWithCatalog(): CatalogApiService {
  const catalog = {
    lists: () =>
      Promise.resolve({
        sites: [
          { id: SITE_HA_NOI, code: 'HN', name: 'Hà Nội' },
          { id: SITE_DA_NANG, code: 'DN', name: 'Đà Nẵng' },
        ],
        cabinets: [{ id: CABINET_A1, code: 'A1', name: 'Tủ A1', siteId: SITE_HA_NOI }],
        deviceTypes: [],
        vendors: [],
      }),
  } as unknown as CatalogService;
  return new CatalogApiService(catalog);
}

describe('validateRefs — cặp tủ mạng ↔ site', () => {
  it('tủ mà KHÔNG có site → chặn, và nói rõ hai đường ra', async () => {
    const errors = await apiWithCatalog().validateRefs({ cabinetId: CABINET_A1 });
    expect(errors).toHaveLength(1);
    // Câu từ chối phải nêu được MÃ TỦ: người sửa cần biết đang vướng cái tủ nào.
    expect(errors[0]).toContain('A1');
    expect(errors[0]).toContain('Site');
  });

  it.each([
    ['', 'ô site bị XOÁ — đúng hình dạng đã lọt'],
    [null, 'gửi null tường minh'],
    [undefined, 'không gửi khoá site lên'],
  ])('site = %p cũng phải chặn (%s)', async (siteId) => {
    const errors = await apiWithCatalog().validateRefs({
      siteId,
      cabinetId: CABINET_A1,
    });
    expect(errors).toHaveLength(1);
  });

  it('tủ ĐÚNG site → cho qua (vế đối chứng)', async () => {
    const errors = await apiWithCatalog().validateRefs({
      siteId: SITE_HA_NOI,
      cabinetId: CABINET_A1,
    });
    expect(errors).toEqual([]);
  });

  it('tủ SAI site → vẫn chặn như cũ, và vẫn đúng một câu lỗi', async () => {
    const errors = await apiWithCatalog().validateRefs({
      siteId: SITE_DA_NANG,
      cabinetId: CABINET_A1,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('không thuộc site đã chọn');
  });

  it('site KHÔNG có tủ → cho qua: một cái máy để trên bàn là chuyện bình thường', async () => {
    expect(await apiWithCatalog().validateRefs({ siteId: SITE_HA_NOI })).toEqual([]);
  });

  it('không site không tủ → cho qua: cả hai đều là ô tuỳ chọn', async () => {
    expect(await apiWithCatalog().validateRefs({})).toEqual([]);
  });

  it('tủ KHÔNG TỒN TẠI → đúng MỘT câu lỗi, không cộng dồn thêm câu "thiếu site"', async () => {
    // Tủ không có thật thì chưa biết nó thuộc site nào — báo thêm "thiếu site" chỉ làm người
    // sửa đi chữa một ô đang không sai.
    const errors = await apiWithCatalog().validateRefs({
      cabinetId: 'bbbbbbbb-0000-0000-0000-00000000dead',
    });
    expect(errors).toEqual(['Tủ mạng không tồn tại.']);
  });
});
