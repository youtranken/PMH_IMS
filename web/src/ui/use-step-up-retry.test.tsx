import { describe, expect, it } from 'vitest';
import { isStepUpCancelled } from './use-step-up-retry';

/**
 * Đóng hộp hỏi mã 6 số là HỦY, không phải lỗi để báo. Mọi nơi gọi `useStepUpRetry().run` hỏi
 * cùng một câu này — một bản, để chữ `STEPUP_CANCELLED` không bị gõ lại (và gõ sai) ở từng màn.
 */
describe('isStepUpCancelled', () => {
  it.each<[unknown, boolean]>([
    [new Error('STEPUP_CANCELLED'), true],
    [new Error('STEPUP_REQUIRED'), false],
    [new Error('Lỗi mạng'), false],
    [null, false],
    [undefined, false],
    ['STEPUP_CANCELLED', false],
  ])('%s → %s', (error, expected) => {
    expect(isStepUpCancelled(error)).toBe(expected);
  });
});
