import { describe, expect, it } from 'vitest';
import { totpState } from './accounts-screen';

/* Ca nguy hiểm là "bắt buộc mà chưa cài" — nó phải tách khỏi "không bắt buộc" bằng màu. */
describe('totpState — cột "2 lớp" ba trạng thái', () => {
  const cases: [string | null, boolean, string, string][] = [
    ['2026-09-01T00:00:00Z', true, 'accounts.totpStateEnrolled', 'ok'],
    ['2026-09-01T00:00:00Z', false, 'accounts.totpStateEnrolled', 'ok'],
    [null, true, 'accounts.totpStateMissing', 'warn'],
    [null, false, 'accounts.totpStateOptional', 'muted'],
  ];
  it.each(cases)('cài=%s, bắt buộc=%s → %s (%s)', (enrolled, required, label, tone) => {
    expect(totpState({ totpEnrolledAt: enrolled, totpLoginRequired: required })).toEqual({
      label,
      tone,
    });
  });
});
