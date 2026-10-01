import type { Type } from '@nestjs/common';
import { dtoErrorBody, PLAIN_TEXT_SAMPLE, SECRET_TEXT_SAMPLE } from '../../test/dto-pipe';
import {
  IpBodyDto,
  NatBodyDto,
  SubnetBodyDto,
  TransitionDto,
  VoidDto,
} from './ipam.controller';

/**
 * Q-19, SEC-21: ô chữ tự do ngoài két không được chứa mật khẩu — cột dạng rõ, còn đi vào lịch
 * sử, file xuất. Chạy pipe thật với `exceptionFactory` của app: mã lỗi phải là
 * `NOTE_LOOKS_LIKE_SECRET` và body không được nhắc lại đoạn bị chặn.
 */
const cases: [string, Type<unknown>, string, Record<string, unknown>][] = [
  ['mô tả dải', SubnetBodyDto, 'description', {}],
  ['ghi chú IP', IpBodyDto, 'note', {}],
  ['lý do cấp IP', IpBodyDto, 'reason', {}],
  ['lý do chuyển trạng thái IP', TransitionDto, 'reason', { to: 'free' }],
  ['ghi chú khi cấp IP', TransitionDto, 'note', { to: 'assigned' }],
  ['lý do xóa IP / dải', VoidDto, 'reason', {}],
  ['lý do mở NAT', NatBodyDto, 'reason', {}],
  ['ghi chú NAT', NatBodyDto, 'note', {}],
];

describe('IP / dải / NAT · ô chữ tự do không chứa mật khẩu (Q-19)', () => {
  it.each(cases)('%s: chặn', async (_label, dto, field, base) => {
    const body = await dtoErrorBody(dto, { ...base, [field]: SECRET_TEXT_SAMPLE });
    expect(body?.code).toBe('NOTE_LOOKS_LIKE_SECRET');
    expect(JSON.stringify(body)).not.toContain('Pmh@Guest2026');
  });

  it.each(cases)('%s: chữ thường thì qua', async (_label, dto, field, base) => {
    expect(await dtoErrorBody(dto, { ...base, [field]: PLAIN_TEXT_SAMPLE })).toBeNull();
  });
});
