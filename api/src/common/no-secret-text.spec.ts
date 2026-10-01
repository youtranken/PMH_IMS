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
 * Điểm danh trên mã nguồn: MỌI trường chữ (`@IsString`) của DTO ngoài két phải được xếp loại
 * tường minh — chữ tự do (phải mang `@NoSecretText`) hay chữ có cấu trúc (mã, tên, IP, email…).
 * Dò theo tên ("note", "description"…) thì ô chữ tự do mang tên khác — "connectedLabel" — lọt
 * im lặng; bắt xếp loại thì trường mới chưa ai xếp làm bài đỏ, và người thêm phải tự trả lời.
 */
describe('Điểm danh @NoSecretText trên DTO', () => {
  const MODULES = join(__dirname, '..', 'modules');
  /** Trường khai riêng một dòng, hoặc đứng cuối dòng decorator (`@IsOptional() @IsString() note?:`). */
  const FIELD = /^\s+(?:@.*\)\s+)?(\w+)[!?]?:\s*[\w[{'"]/;

  /** Chữ tự do: người dùng gõ câu tuỳ ý, cột dạng rõ — phải mang `@NoSecretText`. */
  const FREE_TEXT = new Set([
    'note',
    'description',
    'reason',
    'overSeatReason',
    'connectedLabel',
    'supplies',
    'catalog/catalog.controller.ts#address',
  ]);

  /** Chữ có cấu trúc / ô lọc / chính là bí mật — luật ô chữ tự do không áp. */
  const STRUCTURED = new Set([
    // Mã, tên, nhãn ngắn.
    'code', 'name', 'fullName', 'employeeCode', 'model', 'serial', 'portLabel', 'connectedPort',
    'groupName', 'ownerName', 'assignedTo', 'department', 'usedBy', 'login', 'bandwidth',
    'contract', 'contractNo', 'contact', 'vlan', 'key', 'kind',
    // Mạng.
    'cidr', 'gateway', 'internalIp', 'wanIp', 'allowedIps', 'externalPorts',
    'ipam/ipam.controller.ts#address',
    // Id, ngày, email.
    'siteId', 'deviceTypeId', 'deviceId', 'deviceIds', 'birthDate', 'memberEmail', 'scopeRef',
    'recipients', 'websites', 'kinds',
    // Ô lọc / phân trang của câu truy vấn đọc.
    'action', 'actor', 'objectId', 'objectType', 'search', 'requester', 'page', 'limit',
    'status', 'sort', 'dir', 'usable', 'licenseModel',
    // Chính là bí mật / vé xác thực: đi vào két hoặc chỉ băm, không lưu dạng rõ.
    'password', 'currentPassword', 'newPassword', 'token', 'ticket',
  ]);

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

  /**
   * Khối decorator của MỘT trường: dòng khai trường cộng các dòng decorator ngay trên nó. Dừng
   * ở dòng đã khai trường khác (kết thúc bằng `;`): hai trường một-dòng đứng liền nhau không được
   * mượn decorator của nhau.
   */
  function decoratorBlock(lines: string[], at: number): string {
    const block = [lines[at]];
    for (let i = at - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line.startsWith('@') || line.endsWith(';')) break;
      block.push(lines[i]);
    }
    return block.join('\n');
  }

  const files = dtoFiles(MODULES).filter((f) => !EXEMPT.has(relative(MODULES, f)));
  const freeFields: string[] = [];
  const missing: string[] = [];
  const unclassified: string[] = [];
  for (const file of files) {
    const rel = relative(MODULES, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const m = FIELD.exec(line);
      if (!m) return;
      const block = decoratorBlock(lines, i);
      if (!block.includes('@IsString(')) return;
      const field = m[1];
      const where = `${rel}:${i + 1} ${field}`;
      const scoped = `${rel}#${field}`;
      const free = FREE_TEXT.has(scoped) || (FREE_TEXT.has(field) && !STRUCTURED.has(scoped));
      if (free) {
        freeFields.push(where);
        if (!block.includes('@NoSecretText(')) missing.push(where);
      } else if (!STRUCTURED.has(scoped) && !STRUCTURED.has(field)) {
        unclassified.push(where);
      }
    });
  }

  it('tìm thấy đủ trường để bài có nghĩa', () => {
    // Sàn chống regex hụt: đổi cách viết DTO mà regex không bắt gì thì bài xanh rỗng.
    expect(freeFields.length).toBeGreaterThanOrEqual(20);
  });

  it('mọi trường chữ của DTO đã được xếp loại (tự do / có cấu trúc)', () => {
    expect(unclassified).toEqual([]);
  });

  it('mọi ô chữ tự do ngoài két đều mang @NoSecretText', () => {
    expect(missing).toEqual([]);
  });

  it('địa chỉ site (cột "Địa chỉ / ghi chú" của file mẫu) cũng mang @NoSecretText', () => {
    const catalog = readFileSync(join(MODULES, 'catalog', 'catalog.controller.ts'), 'utf8');
    expect(catalog).toMatch(/@NoSecretText\('Địa chỉ'\)\s*address\?:/);
  });
});
