import { Queue } from 'bullmq';
import { SWEEP_SCHEDULER_ID, scheduleSweep } from '../src/modules/queue/sweep-schedule';
import { testRedisConnection } from './db';

/**
 * OPS-13: nhịp quét định kỳ phải là MỘT lịch duy nhất, dù đổi chu kỳ bao nhiêu lần.
 *
 * `queue.add(..., { repeat: { every }, jobId })` lưu lịch dưới một khoá BĂM từ chính chu kỳ, nên
 * đổi chu kỳ rồi khởi động lại worker là Redis giữ cả lịch cũ lẫn lịch mới: hai nhịp chạy song
 * song, mỗi phút quét hai lần. Chỉ Redis thật trả lời được câu "còn mấy lịch" — hàng đợi giả
 * thì chỉ khẳng định lại đúng lời gọi mà code vừa viết.
 */

const TEST_TIMEOUT = 60_000;

describe('scheduleSweep trên BullMQ + Redis thật', () => {
  let queue: Queue;

  beforeEach(async () => {
    queue = new Queue(`e2e-sweep-${Date.now().toString(36)}`, {
      connection: testRedisConnection(),
    });
    await queue.waitUntilReady();
  }, TEST_TIMEOUT);

  afterEach(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
  }, TEST_TIMEOUT);

  it(
    'đổi chu kỳ rồi gọi lại → vẫn đúng MỘT lịch, mang chu kỳ mới',
    async () => {
      await scheduleSweep(queue, 60_000);
      await scheduleSweep(queue, 30_000);

      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0].key).toBe(SWEEP_SCHEDULER_ID);
      expect(Number(schedulers[0].every)).toBe(30_000);
    },
    TEST_TIMEOUT,
  );

  it(
    'lịch kiểu cũ (`add` + `repeat`) do bản trước để lại bị dọn, không chạy song song với lịch mới',
    async () => {
      await queue.add('tick', {}, { repeat: { every: 60_000 }, jobId: 'sweep-tick' });
      expect(await queue.getJobSchedulers()).toHaveLength(1);

      await scheduleSweep(queue, 60_000);

      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => s.key)).toEqual([SWEEP_SCHEDULER_ID]);
      // Lượt kế tiếp của lịch cũ đã nằm sẵn trong hàng chờ trễ — phải đi cùng lịch của nó.
      const delayed = await queue.getDelayed();
      expect(delayed.every((job) => job.repeatJobKey === SWEEP_SCHEDULER_ID)).toBe(true);
    },
    TEST_TIMEOUT,
  );
});
