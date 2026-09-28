import { describe, expect, it } from 'vitest';
import { PATHS, ROUTE_ROLES, canSeeRoute, titleKeyOf } from '@/lib/routes';

/** Mọi đường tĩnh trong `PATHS` (bỏ các hàm dựng đường chi tiết). */
const STRING_PATHS = (Object.values(PATHS) as unknown[]).filter(
  (value) => typeof value === 'string',
) as string[];

/**
 * VAI NÀO VÀO ĐƯỢC ĐƯỜNG NÀO (B-09).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `/vault` và `/dev/components` gác ngay ở `<Route>`: gõ thẳng URL cũng chỉ nhận 404.
 * `/admin/accounts` và `/admin/vault-access` thì không — Member gõ URL vào là màn dựng đủ
 * `h1`, phụ đề, và một nút "Thêm tài khoản" BẤM ĐƯỢC, rồi mới báo không có quyền.
 *
 * Dữ liệu không rò (API trả 403 sạch), nên đây không phải lỗ bảo mật — nói rõ để không ai
 * đọc quá lời. Nhưng một màn dựng đủ hình hài rồi mới từ chối trông như một LỖI HỆ THỐNG chứ
 * không như một ranh giới quyền, và người dùng sẽ báo là "hệ thống hỏng". Hai cửa cùng loại
 * cư xử khác nhau thì cái nào đúng cũng không còn ai tin.
 *
 * ===== VÌ SAO KIỂM BẢNG CHỨ KHÔNG RENDER `App` =====
 *
 * `App` tự đi hỏi `/auth/me` rồi mới dựng route, nên render nó trong bài kiểm là dựng lại cả
 * tầng mạng cho một câu hỏi về DANH SÁCH. Và một cổng đọc `App.tsx` bằng chuỗi thì chính là
 * loại cổng mà §18 vừa phải sửa bốn cái.
 *
 * Nên luật nằm trong DỮ LIỆU (`ROUTE_ROLES`) và `App` chỉ hỏi `canSeeRoute`. Bảng thì kiểm
 * được bằng hàm thuần, và nó trả lời được câu mà JSX không trả lời nổi: *"có đường `/admin`
 * nào CHƯA khai vai không?"*
 */

const ROLES = ['sa', 'admin', 'member'] as const;

describe('canSeeRoute', () => {
  it.each([
    [PATHS.adminAccounts, 'sa', true],
    [PATHS.adminAccounts, 'admin', false],
    [PATHS.adminAccounts, 'member', false],
    [PATHS.adminVaultAccess, 'admin', true],
    [PATHS.adminVaultAccess, 'member', false],
    [PATHS.vault, 'admin', true],
    [PATHS.vault, 'member', false],
    [PATHS.devComponents, 'sa', true],
    [PATHS.devComponents, 'admin', false],
    [PATHS.adminSettings, 'sa', true],
    [PATHS.adminSettings, 'admin', false],
    [PATHS.adminSettings, 'member', false],
  ] as const)('%s + %s → %s', (path, role, allowed) => {
    expect(canSeeRoute(path, role)).toBe(allowed);
  });

  it('đường KHÔNG khai trong bảng thì mở cho mọi vai (vế đối chứng)', () => {
    // Bảng là danh sách NGOẠI LỆ, không phải danh sách trắng cho toàn bộ ứng dụng. Nếu nó
    // thành danh sách trắng thì thêm một màn thường cũng phải khai, và người ta sẽ khai bừa.
    for (const role of ROLES) {
      expect(canSeeRoute(PATHS.devices, role)).toBe(true);
      expect(canSeeRoute(PATHS.disposal, role)).toBe(true);
    }
  });

  it('không vai nào bị khoá khỏi TẤT CẢ — một bảng khoá sạch là một bảng gõ nhầm', () => {
    for (const role of ROLES) {
      const open = Object.keys(ROUTE_ROLES).filter((path) => canSeeRoute(path, role));
      expect(open.length).toBeGreaterThan(0);
    }
  });
});

/**
 * MẶC-ĐỊNH-ĐÓNG CHO MÀN QUẢN TRỊ — đây mới là bài giữ cho lỗi không tái phát.
 *
 * Hai màn của B-09 không hở vì ai đó quyết định sai; chúng hở vì người viết màn thứ ba, thứ
 * tư không có gì nhắc. Bài này là cái nhắc ấy: thêm một `/admin/...` vào `PATHS` mà quên khai
 * vai là ĐỎ ngay, không phải chờ tới lúc có người gõ URL bằng tay.
 */
describe('mọi đường /admin phải khai vai', () => {
  const stringPaths = (Object.values(PATHS) as unknown[]).filter(
    (value) => typeof value === 'string',
  ) as string[];
  const adminPaths = stringPaths.filter((value) => value.startsWith('/admin'));

  it('tìm được các đường /admin (vế đối chứng cho chính bài này)', () => {
    // Đổi tiền tố `/admin` mà bài này im lặng thì nó thôi canh gì cả.
    expect(adminPaths.length).toBeGreaterThanOrEqual(4);
  });

  it.each(adminPaths)('`%s` có mặt trong ROUTE_ROLES', (path) => {
    expect(Object.keys(ROUTE_ROLES)).toContain(path);
  });

  it('không khai vai cho một đường KHÔNG tồn tại trong PATHS', () => {
    // Chiều ngược lại: một dòng thừa trong bảng là một hàng rào canh cái cửa không có thật,
    // và nó sẽ được chép sang khi ai đó thêm màn mới.
    const known = new Set<string>(stringPaths);
    expect(Object.keys(ROUTE_ROLES).filter((path) => !known.has(path))).toEqual([]);
  });
});

/**
 * TÊN TAB TRÌNH DUYỆT (B-03).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `document.title` KHÔNG được đặt ở đâu trong `web/src` — mười lăm màn dùng chung đúng một
 * cái tên trong `index.html`. Hậu quả không nằm ở thẩm mỹ:
 *
 *   - mở bốn tab IMS để đối chiếu thì cả bốn đọc y hệt nhau, phải bấm từng cái để tìm;
 *   - lịch sử duyệt và dấu trang đều mang một cái tên, nên không tìm lại được bằng tên;
 *   - trình đọc màn hình đọc tên tài liệu khi chuyển tab — nghe cùng một câu ở mọi màn.
 *
 * ===== VÌ SAO LÀ MỘT BẢNG TRONG `routes.ts` =====
 *
 * Cách hiển nhiên là mỗi màn tự gọi `useEffect(() => { document.title = … })`. Mười lăm bản
 * chép tay, và màn thứ mười sáu sẽ quên — không gì đỏ, vì thiếu một dòng effect thì trang
 * vẫn dựng ra bình thường. Đó đúng là lớp lỗi mà `ROUTE_ROLES` ngay trên đây sinh ra để chặn.
 *
 * Bảng thì hỏi được câu JSX không trả lời nổi: *"có đường nào trong `PATHS` chưa có tên tab
 * không?"* — và ô cuối của mục này hỏi đúng câu đó.
 *
 * Tên tab dùng LẠI khoá `nav.*` chứ không đẻ bộ khoá thứ hai: tab trình duyệt và mục sidebar
 * là cùng một màn, hai cái tên khác nhau cho nó là đúng thứ `term-consistency.test.ts` vừa
 * dọn sáu lần.
 */
describe('titleKeyOf — tên tab theo màn', () => {
  it.each([
    [PATHS.dashboard, 'nav.dashboard'],
    [PATHS.devices, 'nav.devices'],
    [PATHS.software, 'nav.software'],
    [PATHS.expiry, 'nav.expiry'],
    [PATHS.adminAccounts, 'nav.accounts'],
    [PATHS.adminVaultAccess, 'nav.vaultAccess'],
    [PATHS.adminSettings, 'nav.settings'],
    // Trang CHI TIẾT đội tên của danh sách nó thuộc về — người dùng nhận ra khu vực trước,
    // còn tên riêng của hồ sơ thì đã nằm trên `h1` của chính trang.
    [PATHS.device('abc-123'), 'nav.devices'],
    [PATHS.subnet('xyz'), 'nav.ipam'],
    [PATHS.serviceAccount('k1'), 'nav.serviceAccounts'],
  ] as const)('%s → %s', (path, key) => {
    expect(titleKeyOf(path)).toBe(key);
  });

  it('đường lạ thì trả `null`, không đoán bừa', () => {
    // `null` để nơi gọi rơi về tên sản phẩm. Đoán bừa một cái tên cho trang 404 thì tab nói
    // rằng trang ấy tồn tại.
    expect(titleKeyOf('/khong-co-duong-nay')).toBeNull();
  });

  it('`/` KHÔNG được khớp như tiền tố của mọi đường', () => {
    // Bẫy của phép khớp tiền tố: '/' là tiền tố của tất cả, nên làm ẩu thì mọi màn đội tên
    // Bảng điều khiển và bài trên vẫn xanh vì nó chỉ kiểm các đường có khai.
    expect(titleKeyOf('/devices/abc')).not.toBe('nav.dashboard');
  });

  it('mọi đường trong PATHS đều có tên tab', () => {
    const missing = STRING_PATHS.filter((path) => titleKeyOf(path) === null);
    expect(missing).toEqual([]);
  });
});
