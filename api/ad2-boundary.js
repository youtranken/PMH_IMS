/**
 * AD-2 — biểu thức nhận diện "import xuyên ruột module khác".
 *
 * Tách ra file riêng vì MỘT lý do: `eslint.config.mjs` và bài test `src/ad2-boundary.spec.ts`
 * phải dùng CHUNG một biểu thức. Bản trước nằm trong config, khớp đúng số không chuỗi, và
 * không có gì báo — hàng rào AD-2 chết âm thầm suốt 9 epic.
 *
 * Luật khớp trên CHUỖI IMPORT NHƯ NGƯỜI TA GÕ (`'../users/users.service'`), không phải đường
 * dẫn đã resolve. Mọi module đều phẳng (`src/modules/<tên>/<file>.ts`), nên trong một module
 * `../X/Y` LUÔN có nghĩa là sang module khác.
 *
 * CommonJS + đuôi `.js` có chủ ý: Node ESM import được nó từ `eslint.config.mjs`, và ts-jest
 * require được nó từ file `.spec.ts`. Đây là mẫu số chung duy nhất của hai bên.
 */

/** Cửa chính của một module: `*.api.ts` (AD-2), `*.module.ts` (Nest DI), `*.types.ts` (hợp đồng kiểu). */
const MODULE_DOORS = String.raw`(?!\.\./[^/]+/[^/]*\.(?:api|module|types)$)`;

/**
 * Nguyên thủy hạ tầng — decorator/guard/kiểu dùng ở gần như mọi module, không có `*.api.ts`
 * vì chúng không phải nghiệp vụ. Danh sách ĐÓNG: thêm một dòng là phải sửa file này, tức là
 * phải giải thích trong PR.
 */
const INFRA_PRIMITIVES = [
  String.raw`(?!\.\./auth/(?:roles\.decorator|types|step-up\.guard|session-policy)$)`,
  String.raw`(?!\.\./audit/(?:audited\.decorator|audit-writer\.service)$)`,
  String.raw`(?!\.\./config-sys/system-config\.(?:service|keys)$)`,
  String.raw`(?!\.\./outbox/outbox\.service$)`,
  String.raw`(?!\.\./queue/sweep\.service$)`,
].join('');

/**
 * `../<module>/<file>`. `[^./]` ở ký tự đầu tên module chặn `../../common/...` lọt vào —
 * đi lên hai tầng là ra khỏi `src/modules/`, đó là chuyện của dependency-cruiser.
 */
const CROSS_MODULE_TAIL = String.raw`\.\./[^./][^/]*/.+$`;

const AD2_MESSAGE =
  'AD-2: chỉ được import `*.api.ts` / `*.module.ts` / `*.types.ts` của module khác. ' +
  'Cần thêm thứ gì thì mở rộng public api của module đó, không chạm file nội bộ.';

/**
 * @param {string} [extraExceptions] thêm lookahead phủ định (dạng `(?!...)`) cho ngoại lệ
 *   khai tường minh — hiện chỉ dùng cho cặp `auth`↔`users` (một chủ sở hữu theo AD-3).
 * @returns {string} nguồn regex cho `no-restricted-imports`.
 */
function ad2PatternSource(extraExceptions = '') {
  return `^${MODULE_DOORS}${INFRA_PRIMITIVES}${extraExceptions}${CROSS_MODULE_TAIL}`;
}

module.exports = {
  AD2_MESSAGE,
  AUTH_USERS_EXCEPTION: String.raw`(?!\.\./users/.+$)`,
  ad2PatternSource,
};
