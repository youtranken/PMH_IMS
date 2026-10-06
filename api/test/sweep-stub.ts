import type { SweepService } from '../src/modules/queue/sweep.service';

/** Bài kiểm tự gọi hàm quét khi cần; lịch quét mỗi phút của BullMQ không chạy ở đây. */
export const noSweep = { register: () => undefined } as unknown as SweepService;
