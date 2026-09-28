import { SetMetadata } from '@nestjs/common';

export const NO_IDLE_TOUCH_KEY = 'ims:no-idle-touch';

/**
 * Route này được màn hình TỰ HỎI định kỳ, nên không được tính là "người dùng còn đang ngồi đó".
 *
 * NFR-01 hứa phiên chết sau 30 phút không thao tác. `SessionGuard` gia hạn idle ở mọi request;
 * nếu cả vòng hỏi badge/phiếu treo cũng gia hạn thì một tab bỏ mở trên máy dùng chung sống tới
 * hết hạn tuyệt đối, và người ngồi vào sau thừa hưởng quyền của người trước.
 *
 * Chỉ gắn cho route đọc mà client gọi theo đồng hồ. Route người dùng bấm mới gọi thì KHÔNG gắn:
 * gắn nhầm làm phiên của người đang làm việc thật chết giữa chừng.
 *
 * Metadata thuần, tách khỏi guard vì mọi module có vòng hỏi đều cần khai nó (cùng lý do
 * `step-up.decorator` tách khỏi `step-up.guard`).
 */
export const NoIdleTouch = () => SetMetadata(NO_IDLE_TOUCH_KEY, true);
