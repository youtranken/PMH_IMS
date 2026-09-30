import { plainToInstance } from 'class-transformer';
import { IsOptional } from 'class-validator';
import { validate } from 'class-validator';
import { IsPhone, normalizePhone, PHONE_MESSAGE, formatPhone } from './phone';

/**
 * Q-18: số điện thoại chỉ nhận chữ số, dấu `+` ở đầu và dấu cách; lưu thì bỏ dấu cách.
 * Một luật cho cả danh mục, đường truyền, người dùng IMS và file Excel nhập danh mục.
 */
describe('normalizePhone', () => {
  it.each([
    ['0912 345 678', '0912345678'],
    ['+84 28 3822 1234', '+842838221234'],
    ['  1900 6600  ', '19006600'],
    ['18008098', '18008098'],
    ['+84912345678', '+84912345678'],
    ['', ''],
    ['   ', ''],
  ])('"%s" → "%s"', (input, expected) => {
    expect(normalizePhone(input)).toEqual({ value: expected, error: null });
  });

  it.each([
    ['(028) 3822-1234'],
    ['0912.345.678'],
    ['84+912'],
    ['++84912'],
    ['+'],
    ['gọi anh Hùng nhé'],
    ['0912 345 678 ext 2'],
  ])('"%s" bị từ chối', (input) => {
    expect(normalizePhone(input)).toEqual({ value: null, error: PHONE_MESSAGE });
  });
});

class Dto {
  @IsOptional() @IsPhone(12) phone?: string;
}

async function check(phone: unknown) {
  const dto = plainToInstance(Dto, { phone });
  const errors = await validate(dto);
  return { phone: dto.phone, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
}

describe('@IsPhone — DTO bỏ dấu cách rồi mới kiểm', () => {
  it.each([
    ['0912 345 678', '0912345678'],
    ['+84 912 345 678', '+84912345678'],
    ['', ''],
  ])('"%s" hợp lệ, lưu thành "%s"', async (input, stored) => {
    expect(await check(input)).toEqual({ phone: stored, messages: [] });
  });

  it('ký tự khác bị từ chối bằng câu tiếng Việt', async () => {
    const { messages } = await check('(028) 3822-1234');
    expect(messages).toContain(PHONE_MESSAGE);
  });

  it('độ dài tính SAU khi bỏ dấu cách', async () => {
    expect((await check('0912 345 678 90')).messages).toEqual([]);
    expect((await check('0912345678901')).messages.length).toBeGreaterThan(0);
  });

  it('không phải chuỗi thì bị từ chối, không ném', async () => {
    expect((await check(912345678)).messages.length).toBeGreaterThan(0);
  });
});

describe('formatPhone — cùng luật tách nhóm với web (lib/phone-format.ts)', () => {
  it.each([
    ['0912345678', '0912 345 678'],
    ['02838221234', '028 3822 1234'],
    ['19006600', '1900 6600'],
    ['1900545415', '1900 5454 15'],
    ['+84912345678', '+84 912 345 678'],
    ['113', '113'],
  ])('%s → %s', (raw, expected) => {
    expect(formatPhone(raw)).toBe(expected);
  });
});
