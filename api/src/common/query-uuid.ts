import { applyDecorators } from '@nestjs/common';
import { IsOptional, IsUUID, Matches, ValidateIf } from 'class-validator';

/*
 * Bộ lọc id trên query string đi thẳng xuống `eq(...)` / `inArray(...)`: chuỗi rác tới Postgres
 * thành 22P02 và bung 500. Chặn ở DTO để ra 400 có câu tiếng Việt.
 *
 * Chuỗi rỗng được nhận: web xoá bộ lọc bằng cách gửi `?siteId=`, và service coi '' là không lọc.
 */
export function OptionalUuidQuery(message: string): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    ValidateIf((_o: unknown, v: unknown) => v !== ''),
    IsUUID(undefined, { message }),
  );
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_LIST = new RegExp(`^\\s*${UUID}\\s*(,\\s*${UUID}\\s*)*$`, 'i');

/**
 * `?ids=a,b,c`. Một mục rác thì cả tham số là 400: lặng lẽ bỏ mục đó là trả về tập RỘNG hơn cái
 * người dùng đã chọn mà không ai biết.
 */
export function OptionalUuidListQuery(message: string): PropertyDecorator {
  return applyDecorators(
    IsOptional(),
    ValidateIf((_o: unknown, v: unknown) => v !== ''),
    Matches(UUID_LIST, { message }),
  );
}

/** Tách `a, b` thành mảng id đã qua `OptionalUuidListQuery`; rỗng thì không lọc. */
export function splitUuidList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}
