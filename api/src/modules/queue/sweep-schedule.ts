import type { Queue } from 'bullmq';
import { SWEEP_JOB_OPTIONS } from './queue.constants';

/** Id cố định của lịch quét: upsert theo id này là thứ giữ cho chỉ có MỘT nhịp (OPS-13). */
export const SWEEP_SCHEDULER_ID = 'sweep-tick';

/**
 * Đặt (hoặc đổi) nhịp quét định kỳ — gọi mỗi lần worker khởi động.
 *
 * Dùng `upsertJobScheduler` chứ không `add(..., { repeat })`: kiểu cũ lưu lịch dưới khoá băm từ
 * chính chu kỳ, nên đổi chu kỳ là Redis giữ cả hai lịch và quét chạy hai nhịp song song.
 *
 * Mọi lịch KHÁC trong hàng đợi này bị gỡ: hàng đợi quét chỉ có một việc, nên lịch lạ chỉ có thể
 * là lịch kiểu cũ (khoá băm) còn sót trong Redis, và để nó sống là quay lại đúng lỗi trên.
 */
export async function scheduleSweep(
  queue: Pick<Queue, 'upsertJobScheduler' | 'getJobSchedulers' | 'removeJobScheduler'>,
  everyMs: number,
): Promise<void> {
  await queue.upsertJobScheduler(
    SWEEP_SCHEDULER_ID,
    { every: everyMs },
    { name: 'tick', data: {}, opts: SWEEP_JOB_OPTIONS },
  );
  for (const scheduler of await queue.getJobSchedulers()) {
    if (scheduler.key !== SWEEP_SCHEDULER_ID) await queue.removeJobScheduler(scheduler.key);
  }
}
