import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AuditQueryDto } from './audit.controller';
import { COUNT_CAP } from './audit-query.service';

/**
 * Trần của `page` (DOM-07). Chạy `ValidationPipe` với đúng các cờ của `app.setup.ts` để hỏi
 * câu thật: query string (luôn là chuỗi) có bị chặn ở cửa hay không.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function parse(query: Record<string, string>) {
  return pipe.transform(query, { type: 'query', metatype: AuditQueryDto });
}

describe('AuditQueryDto — trần của `page`', () => {
  it.each([
    ['1', 1],
    [String(COUNT_CAP), COUNT_CAP],
  ])('page=%s qua được', async (raw, expected) => {
    const dto = (await parse({ page: raw })) as AuditQueryDto;
    expect(dto.page).toBe(expected);
  });

  it.each([String(COUNT_CAP + 1), '1000000000000000', '0'])('page=%s bị chặn 400', async (raw) => {
    await expect(parse({ page: raw })).rejects.toBeInstanceOf(BadRequestException);
  });
});
