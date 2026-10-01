import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { IsOptional, IsString, Length } from 'class-validator';
import { NoSecretText, secretTextMessage } from './no-secret-text';
import { validationException } from './validation-messages';

/**
 * Chạy `ValidationPipe` THẬT với đúng `exceptionFactory` của app: điều cần chứng minh là body
 * lỗi mang mã `NOTE_LOOKS_LIKE_SECRET` và câu nêu tên ô — và KHÔNG nhắc lại đoạn chữ bị chặn.
 */
class SampleDto {
  @IsOptional() @IsString() @Length(0, 2000) @NoSecretText() note?: string;
  @IsOptional() @IsString() @Length(0, 400) @NoSecretText('Địa chỉ') address?: string;
  @IsOptional() @IsString() @Length(0, 10) code?: string;
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: validationException,
});

async function bodyOf(payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    await pipe.transform(payload, { type: 'body', metatype: SampleDto });
    return null;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse() as Record<string, unknown>;
  }
}

describe('@NoSecretText', () => {
  it('chữ thường thì qua', async () => {
    expect(await bodyOf({ note: 'Model WS-C2960X-48FPD-L, serial FOC2010X1AB' })).toBeNull();
    expect(await bodyOf({ note: null })).toBeNull();
    expect(await bodyOf({})).toBeNull();
  });

  it('chặn với mã NOTE_LOOKS_LIKE_SECRET, câu nêu tên ô, không nhắc lại bí mật', async () => {
    const body = await bodyOf({ note: 'mk wifi: Pmh@Guest2026' });
    expect(body?.code).toBe('NOTE_LOOKS_LIKE_SECRET');
    expect(String(body?.message)).toContain('Ghi chú');
    expect(JSON.stringify(body)).not.toContain('Pmh@Guest2026');
  });

  it('nhãn khai tay thắng nhãn chung của tên trường', async () => {
    const body = await bodyOf({ address: 'Key VK7JG-NPHTM-C97JM-9MPGT-3V66T' });
    expect(body?.message).toBe(secretTextMessage('Địa chỉ'));
  });

  it('lỗi khác không mang mã này — hợp đồng cũ BAD_REQUEST giữ nguyên', async () => {
    const body = await bodyOf({ code: 'quá-dài-quá-mười-ký-tự' });
    expect(body?.code).toBeUndefined();
    expect(Array.isArray(body?.message)).toBe(true);
  });

  it('lẫn với lỗi khác: vẫn mang mã chặn, đủ cả hai câu', async () => {
    const body = await bodyOf({ code: 'quá-dài-quá-mười-ký-tự', note: 'Admin@123456 nhé' });
    expect(body?.code).toBe('NOTE_LOOKS_LIKE_SECRET');
    expect(String(body?.message)).toContain('Mã hồ sơ');
    expect(String(body?.message)).toContain('Ghi chú');
  });
});

/**
 * Điểm danh trên mã nguồn: mọi trường ghi chú / mô tả / lý do của DTO ngoài két phải mang
 * `@NoSecretText`. Thiếu bài này thì DTO tiếp theo thêm ô "Ghi chú" mà quên decorator, và cửa
 * vòng qua két mở lại im lặng.
 */
describe('Điểm danh @NoSecretText trên DTO', () => {
  const MODULES = join(__dirname, '..', 'modules');
  // Trường khai riêng một dòng, hoặc đứng cuối dòng decorator (`@IsOptional() @IsString() note?:`).
  const FREE_TEXT_FIELD = /^\s+(?:@.*\)\s+)?(note|description|reason|overSeatReason)[!?]?:/;
  /*
   * Ghi chú két đi theo luật RIÊNG, chặt hơn (`noteLooksLikeSecret` + so với giá trị trong
   * `VaultService`) — gắn thêm luật ô tự do ở cửa DTO sẽ đổi hành vi két.
   */
  const EXEMPT = new Set(['vault/vault.controller.ts']);

  function dtoFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return dtoFiles(full);
      return e.isFile() && /\.(controller|dto)\.ts$/.test(e.name) ? [full] : [];
    });
  }

  /** Khối decorator ngay trên (và trên cùng dòng với) dòng khai trường. */
  function decoratorBlock(lines: string[], at: number): string {
    const block = [lines[at]];
    for (let i = at - 1; i >= 0 && lines[i].trim().startsWith('@'); i--) block.push(lines[i]);
    return block.join('\n');
  }

  const files = dtoFiles(MODULES).filter((f) => !EXEMPT.has(relative(MODULES, f)));
  const fields: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = FREE_TEXT_FIELD.exec(line);
      if (!m || !decoratorBlock(lines, i).includes('@Is')) return;
      const where = `${relative(MODULES, file)}:${i + 1} ${m[1]}`;
      fields.push(where);
      if (!decoratorBlock(lines, i).includes('@NoSecretText(')) missing.push(where);
    });
  }

  it('tìm thấy đủ trường để bài có nghĩa', () => {
    // Sàn chống regex hụt: đổi cách viết DTO mà regex không bắt gì thì bài xanh rỗng.
    expect(fields.length).toBeGreaterThanOrEqual(20);
  });

  it('mọi ghi chú / mô tả / lý do ngoài két đều mang @NoSecretText', () => {
    expect(missing).toEqual([]);
  });

  it('địa chỉ site (cột "Địa chỉ / ghi chú" của file mẫu) cũng mang @NoSecretText', () => {
    const catalog = readFileSync(join(MODULES, 'catalog', 'catalog.controller.ts'), 'utf8');
    expect(catalog).toMatch(/@NoSecretText\('Địa chỉ'\)\s*address\?:/);
  });
});
