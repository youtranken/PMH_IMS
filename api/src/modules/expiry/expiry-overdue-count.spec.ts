import { PATH_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../auth/roles.decorator';
import { NO_IDLE_TOUCH_KEY } from '../auth/no-idle-touch.decorator';
import { ExpiryController } from './expiry.controller';
import type { ExpiryService } from './expiry.service';

/**
 * Badge "đã quá hạn" trên mục menu Sắp hết hạn (SHELL-009).
 *
 * Shell hỏi con số này ở MỌI màn, định kỳ. Hai điều phải giữ: nó đếm đúng như màn Sắp hết hạn
 * đếm (cùng `summary.expired`, không tự viết luật thứ hai), và nó KHÔNG được làm phiên sống mãi
 * — tab bỏ quên ở máy dùng chung phải hết idle như mọi tab khác (NFR-01).
 */
describe('GET /expiry/overdue/count', () => {
  function controllerWith(summary: { expired: number; critical: number; warning: number }) {
    const list = jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      summary,
      thresholds: { criticalDays: 7, warningDays: 30 },
      failedKinds: [],
    });
    const expiry = { list } as unknown as ExpiryService;
    return { controller: new ExpiryController(expiry, {} as never, {} as never, {} as never), list };
  }

  it('trả đúng số mục đã quá hạn của màn hình, không kéo cả trang dữ liệu', async () => {
    const { controller, list } = controllerWith({ expired: 3, critical: 5, warning: 9 });
    await expect(controller.overdueCount()).resolves.toEqual({ count: 3 });
    const query = list.mock.calls[0][0] as { includeExpired?: boolean; limit?: number };
    expect(query.includeExpired).toBe(true);
    expect(query.limit).toBe(1);
  });

  it('không có gì quá hạn → 0', async () => {
    const { controller } = controllerWith({ expired: 0, critical: 2, warning: 0 });
    await expect(controller.overdueCount()).resolves.toEqual({ count: 0 });
  });

  it('mọi vai xem được, và route mang cờ không gia hạn idle', () => {
    const handler = (ExpiryController.prototype as unknown as Record<string, object>).overdueCount;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('overdue/count');
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['sa', 'admin', 'member']);
    expect(Reflect.getMetadata(NO_IDLE_TOUCH_KEY, handler)).toBe(true);
  });
});
