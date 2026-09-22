import { describe, expect, it } from 'vitest';
import { PATHS, ROUTE_ROLES, canSeeRoute } from '@/lib/routes';

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
