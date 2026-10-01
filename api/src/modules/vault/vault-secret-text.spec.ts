import { randomUUID } from 'node:crypto';
import type { Type } from '@nestjs/common';
import { dtoErrorBody, PLAIN_TEXT_SAMPLE, SECRET_TEXT_SAMPLE } from '../../test/dto-pipe';
import { DecisionDto, RequestDto } from './break-glass.controller';
import { AccessRuleDto } from './vault-access.controller';

/**
 * Q-19, SEC-21: ô chữ tự do ngoài két không được chứa mật khẩu — cột dạng rõ, còn đi vào lịch
 * sử, file xuất. Chạy pipe thật với `exceptionFactory` của app: mã lỗi phải là
 * `NOTE_LOOKS_LIKE_SECRET` và body không được nhắc lại đoạn bị chặn.
 */
const cases: [string, Type<unknown>, string, Record<string, unknown>][] = [
  ['lý do xin quyền (đi cả vào email người duyệt)', RequestDto, 'reason', { ownerType: 'device', ownerId: randomUUID(), hours: 1 }],
  ['ghi chú của người duyệt', DecisionDto, 'note', {}],
  ['ghi chú lời gán quyền két', AccessRuleDto, 'note', { memberEmail: 'a@pmh.com.vn', scopeType: 'device_site', scopeRef: 'x', tier: 'whitelist' }],
];

describe('Phiếu xin quyền két / quyền két · ô chữ tự do không chứa mật khẩu (Q-19)', () => {
  it.each(cases)('%s: chặn', async (_label, dto, field, base) => {
    const body = await dtoErrorBody(dto, { ...base, [field]: SECRET_TEXT_SAMPLE });
    expect(body?.code).toBe('NOTE_LOOKS_LIKE_SECRET');
    expect(JSON.stringify(body)).not.toContain('Pmh@Guest2026');
  });

  it.each(cases)('%s: chữ thường thì qua', async (_label, dto, field, base) => {
    expect(await dtoErrorBody(dto, { ...base, [field]: PLAIN_TEXT_SAMPLE })).toBeNull();
  });
});
