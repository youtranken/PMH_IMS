/**
 * AD-2 — biểu thức nhận diện "import xuyên ruột module khác".
 *
 * Tách ra file riêng vì MỘT lý do: `eslint.config.mjs` và bài test `src/ad2-boundary.spec.ts`
 * phải dùng CHUNG một biểu thức. Bản trước nằm trong config, khớp đúng số không chuỗi, và
 * không có gì báo — hàng rào AD-2 chết âm thầm suốt 9 epic.
 *
 * Luật khớp trên CHUỖI IMPORT NHƯ NGƯỜI TA GÕ (`'../users/users.service'`), không phải đường
 * dẫn đã resolve. Đó là giới hạn của `no-restricted-imports`, và nó đẻ ra đúng một loại lỗ:
 * MỘT file có nhiều cách gõ.
 *
 * ===== LỖ ĐÃ VÁ 08/09 (rà soát 07/09, #9) =====
 *
 * Bản trước neo `^\.\./[^./]` — chỉ nhìn thấy đúng một cách viết:
 *
 *     import { IpAddressService } from '../ipam/ip-address.service';             // bị chặn
 *     import { IpAddressService } from '../../modules/ipam/ip-address.service';  // LỌT
 *
 * Hai dòng resolve về CÙNG một file. `[^./]` được thêm để `../../common/...` không bị bắt oan,
 * kèm lập luận "đi lên hai tầng là ra khỏi `src/modules/`". Lập luận đó đúng với `common/` và
 * SAI với `modules/`: đi lên hai tầng rồi quay vào `modules/` thì vẫn ở nguyên trong đó.
 *
 * `tsconfig.json` của api còn đặt `baseUrl: "./"`, nên `src/modules/ipam/...` cũng resolve
 * được mà không có `../` nào — cách viết thứ ba của cùng một file.
 *
 * Nguy hiểm không nằm ở người cố tình lách. Nó nằm ở người "sửa import cho tường minh hơn":
 * hàng rào biến mất mà không ai thấy, đúng cơ chế đã giết luật này một lần rồi.
 *
 * dependency-cruiser bắt được đường vòng này ở vế **nghiệp vụ ↔ nghiệp vụ** (`biz-cross-only-
 * via-api` khớp trên đường dẫn ĐÃ RESOLVE). Nhưng nó không có luật nào cho **nền ↔ nền** hay
 * **nghiệp vụ → nội bộ của nền**, mà eslint thì có — nên ở hai vế đó, lỗ này là lỗ THẬT,
 * không ai canh.
 *
 * CommonJS + đuôi `.js` có chủ ý: Node ESM import được nó từ `eslint.config.mjs`, và ts-jest
 * require được nó từ file `.spec.ts`. Đây là mẫu số chung duy nhất của hai bên.
 */

/**
 * Hai lối vào `src/modules/<tên>/`, ứng với mọi cách gõ ra cùng một file:
 *
 *   1. `^\.\./`            — module anh em, đứng cạnh nhau (mọi module đều phẳng).
 *   2. `(?:^|/)modules/`   — có chữ `modules/` trong đường dẫn: `../../modules/x/y`,
 *                            `../../../src/modules/x/y`, `src/modules/x/y`, `modules/x/y`.
 *
 * Lối 1 không nuốt `../../common/tx`: phần đuôi bắt buộc mở đầu bằng `[^./]`, mà sau `../`
 * thứ nhất là dấu chấm.
 *
 * Đánh đổi đã biết: một gói npm tên dạng `<gì đó>/modules/<a>/<b>` sẽ bị bắt oan. Repo không
 * có gói nào như vậy, và hướng sai này là hướng ĐÚNG để sai — nó ồn ào (lint đỏ, sửa bằng một
 * dòng ngoại lệ), chứ không im lặng như lỗ vừa vá.
 */
const MODULE_ENTRIES = String.raw`(?:^\.\./|(?:^|/)modules/)`;

/** Cửa chính của một module: `*.api.ts` (AD-2), `*.module.ts` (Nest DI), `*.types.ts` (hợp đồng kiểu). */
const MODULE_DOORS = String.raw`(?![^/]+/[^/]*\.(?:api|module|types)$)`;

/**
 * Nguyên thủy hạ tầng — decorator/guard/kiểu dùng ở gần như mọi module, không có `*.api.ts`
 * vì chúng không phải nghiệp vụ. Danh sách ĐÓNG: thêm một dòng là phải sửa file này, tức là
 * phải giải thích trong PR.
 *
 * Lookahead viết trên PHẦN ĐUÔI (`auth/roles.decorator`), không kèm `../` — nhờ vậy chúng áp
 * cho cả sáu cách gõ ở `MODULE_ENTRIES`, không chỉ cách gõ ngắn.
 */
const INFRA_PRIMITIVES = [
  String.raw`(?!auth/(?:roles\.decorator|types|step-up\.guard|session-policy)$)`,
  String.raw`(?!audit/(?:audited\.decorator|audit-writer\.service)$)`,
  String.raw`(?!config-sys/system-config\.(?:service|keys)$)`,
  String.raw`(?!outbox/outbox\.service$)`,
  String.raw`(?!queue/sweep\.service$)`,
].join('');

/** `<module>/<file>`. `[^./]` ở ký tự đầu tên module chặn `../../common/...` lọt vào lối 1. */
const CROSS_MODULE_TAIL = String.raw`[^./][^/]*/.+$`;

const AD2_MESSAGE =
  'AD-2: chỉ được import `*.api.ts` / `*.module.ts` / `*.types.ts` của module khác. ' +
  'Cần thêm thứ gì thì mở rộng public api của module đó, không chạm file nội bộ. ' +
  '(Viết dài ra — `../../modules/x/y` hay `src/modules/x/y` — cũng là cùng file, cũng bị chặn.)';

/**
 * @param {string} [extraExceptions] thêm lookahead phủ định (dạng `(?!...)`) cho ngoại lệ
 *   khai tường minh — hiện chỉ dùng cho cặp `auth`↔`users` (một chủ sở hữu theo AD-3).
 * @returns {string} nguồn regex cho `no-restricted-imports`.
 */
function ad2PatternSource(extraExceptions = '') {
  return `${MODULE_ENTRIES}${MODULE_DOORS}${INFRA_PRIMITIVES}${extraExceptions}${CROSS_MODULE_TAIL}`;
}

module.exports = {
  AD2_MESSAGE,
  AUTH_USERS_EXCEPTION: String.raw`(?!users/.+$)`,
  ad2PatternSource,
};
