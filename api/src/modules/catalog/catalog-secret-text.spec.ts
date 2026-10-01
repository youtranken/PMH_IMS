import type { Type } from '@nestjs/common';
import { dtoErrorBody, PLAIN_TEXT_SAMPLE, SECRET_TEXT_SAMPLE } from '../../test/dto-pipe';
import { CatalogBodyDto } from './catalog.controller';

/**
 * Q-19, SEC-21: ô chữ tự do ngoài két không được chứa mật khẩu — cột dạng rõ, còn đi vào lịch
 * sử, file xuất. Chạy pipe thật với `exceptionFactory` của app: mã lỗi phải là
 * `NOTE_LOOKS_LIKE_SECRET` và body không được nhắc lại đoạn bị chặn.
 */
const cases: [string, Type<unknown>, string, Record<string, unknown>][] = [
  ['mô tả (tủ, loại thiết bị, bộ phận, dịch vụ)', CatalogBodyDto, 'description', {}],
  ['địa chỉ / ghi chú site', CatalogBodyDto, 'address', {}],
];

describe('Danh mục · ô chữ tự do không chứa mật khẩu (Q-19)', () => {
  it.each(cases)('%s: chặn', async (_label, dto, field, base) => {
    const body = await dtoErrorBody(dto, { ...base, [field]: SECRET_TEXT_SAMPLE });
    expect(body?.code).toBe('NOTE_LOOKS_LIKE_SECRET');
    expect(JSON.stringify(body)).not.toContain('Pmh@Guest2026');
  });

  it.each(cases)('%s: chữ thường thì qua', async (_label, dto, field, base) => {
    expect(await dtoErrorBody(dto, { ...base, [field]: PLAIN_TEXT_SAMPLE })).toBeNull();
  });
});
