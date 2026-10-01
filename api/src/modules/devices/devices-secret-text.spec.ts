import type { Type } from '@nestjs/common';
import { dtoErrorBody, PLAIN_TEXT_SAMPLE, SECRET_TEXT_SAMPLE } from '../../test/dto-pipe';
import { DeviceBodyDto, PortBodyDto } from './devices.controller';

/**
 * Q-19, SEC-21: ô chữ tự do ngoài két không được chứa mật khẩu — cột dạng rõ, còn đi vào lịch
 * sử, file xuất. Chạy pipe thật với `exceptionFactory` của app: mã lỗi phải là
 * `NOTE_LOOKS_LIKE_SECRET` và body không được nhắc lại đoạn bị chặn.
 */
const cases: [string, Type<unknown>, string, Record<string, unknown>][] = [
  ['ghi chú thiết bị', DeviceBodyDto, 'note', {}],
  ['ghi chú cổng (port map)', PortBodyDto, 'note', {}],
];

describe('Thiết bị · ô chữ tự do không chứa mật khẩu (Q-19)', () => {
  it.each(cases)('%s: chặn', async (_label, dto, field, base) => {
    const body = await dtoErrorBody(dto, { ...base, [field]: SECRET_TEXT_SAMPLE });
    expect(body?.code).toBe('NOTE_LOOKS_LIKE_SECRET');
    expect(JSON.stringify(body)).not.toContain('Pmh@Guest2026');
  });

  it.each(cases)('%s: chữ thường thì qua', async (_label, dto, field, base) => {
    expect(await dtoErrorBody(dto, { ...base, [field]: PLAIN_TEXT_SAMPLE })).toBeNull();
  });
});
