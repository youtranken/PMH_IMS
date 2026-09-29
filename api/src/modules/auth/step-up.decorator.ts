import { SetMetadata } from '@nestjs/common';

/**
 * Metadata của step-up (FR-022) — TÁCH khỏi `step-up.guard.ts` có chủ ý.
 *
 * ===== VÌ SAO TÁCH =====
 *
 * `StepUpGuard` là guard TOÀN CỤC và MẶC ĐỊNH ĐÓNG: mọi route phải khai lập trường
 * (`@RequiresStepUp()` hoặc `@NoStepUp()`), không khai thì 403. Nghĩa là mười tám controller
 * của mọi module đều phải import một decorator nằm trong module `auth` — đúng tình huống mà
 * `@Roles` đã có từ đầu.
 *
 * Và repo đã giải bài đó rồi: `auth/roles.decorator` nằm trong `INFRA_PRIMITIVES` (ngoại lệ
 * AD-2 toàn cục), còn `auth/roles.guard` thì KHÔNG — vì chỉ `app.module` cần tới guard. File
 * này là vế tương ứng cho step-up: metadata thuần, không phụ thuộc gì, mở cho mọi module;
 * guard giữ nguyên bên trong `auth`.
 *
 * ===== VÌ SAO FILE NÀY LÀ NGOẠI LỆ AD-2 MÀ GUARD THÌ KHÔNG =====
 *
 * Với mặc-định-đóng, lập trường step-up là thứ MỌI route phải trả lời, nên nó thật sự cắt
 * ngang toàn hệ — cùng lý do khiến `@Roles` là ngoại lệ chính đáng.
 *
 * Cái KHÔNG đổi: `step-up.guard` vẫn nằm ngoài danh sách. Module nào import guard chứ không
 * phải decorator thì lint vẫn đỏ, và đó vẫn là lúc cần một cuộc trò chuyện.
 */
export const REQUIRES_STEP_UP_KEY = 'ims:requires-step-up';

/**
 * FR-022: route này đòi đã gõ TOTP trong `secret.stepup_grace_minutes` phút gần nhất.
 *
 * Vì sao là decorator + guard chứ không phải một câu `if` trong service: cửa mở két nhiều dần
 * (xem secret, break-glass, xuất khóa khi bàn giao). Mỗi chỗ tự viết `if` là mỗi
 * chỗ có thể quên, hoặc quên khác kiểu — và cái quên đó không làm test nào đỏ.
 */
export const RequiresStepUp = () => SetMetadata(REQUIRES_STEP_UP_KEY, true);

/**
 * Khai RÕ rằng route (hoặc cả controller) không đòi gõ mã.
 *
 * Không phải thủ tục thừa — đây là vế còn lại của mặc-định-đóng. "Im lặng" không còn được coi
 * là "không cần", vì im lặng đúng là cách `/api/v1/accounts/*` đứng ngoài hàng rào suốt chín
 * epic. Xem khối chú thích ở `StepUpGuard.canActivate`.
 *
 * Đặt được ở CẤP LỚP, và nên đặt ở đó. 136 route mà bắt từng route khai thì có 131 dòng chỉ
 * để nói "không cần" — tiếng ồn, và tiếng ồn thì người ta dán bừa cho qua. Khai một dòng trên
 * controller rồi ghi đè ở đúng những route cần, thì mỗi dòng `@RequiresStepUp()` đều đọc ra ý
 * nghĩa của nó.
 */
export const NoStepUp = () => SetMetadata(REQUIRES_STEP_UP_KEY, false);
