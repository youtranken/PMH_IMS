import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PHONE_MESSAGE } from '../../common/phone';
import { IspBodyDto } from './isp-line.controller';

/** Q-18: hotline đường truyền theo luật số điện thoại chung. */
describe('IspBodyDto — hotline', () => {
  it.each([
    ['1900 6600', '19006600'],
    ['18008098', '18008098'],
    ['', ''],
  ])('"%s" lưu thành "%s"', async (input, stored) => {
    const dto = plainToInstance(IspBodyDto, { hotline: input });
    expect(await validate(dto)).toEqual([]);
    expect(dto.hotline).toBe(stored);
  });

  it('chữ lẫn vào số bị từ chối', async () => {
    const dto = plainToInstance(IspBodyDto, { hotline: '1900 6600 nhánh 2' });
    const messages = (await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(PHONE_MESSAGE);
  });
});
