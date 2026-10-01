import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PHONE_MESSAGE } from '../../common/phone';
import { ContactDto } from './accounts.controller';

/** Q-18: SĐT người dùng IMS theo luật số điện thoại chung (tạo mới lẫn sửa hồ sơ). */
describe('ContactDto — phone', () => {
  it.each([
    ['0912 345 678', '0912345678'],
    ['+84 912 345 678', '+84912345678'],
    ['(028) 3822-1234', '02838221234'],
    ['0912.345.678', '0912345678'],
    ['', ''],
  ])('"%s" lưu thành "%s"', async (input, stored) => {
    const dto = plainToInstance(ContactDto, { phone: input });
    expect(await validate(dto)).toEqual([]);
    expect(dto.phone).toBe(stored);
  });

  it.each(['0912/345/678', '0912 345 678 ext 2', 'gọi anh Hùng nhé'])(
    '"%s" bị từ chối',
    async (input) => {
      const dto = plainToInstance(ContactDto, { phone: input });
      const messages = (await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}));
      expect(messages).toContain(PHONE_MESSAGE);
    },
  );
});
