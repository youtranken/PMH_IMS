import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PHONE_MESSAGE } from '../../common/phone';
import { CatalogBodyDto } from './catalog.controller';

/** Q-18: SĐT nhà cung cấp và hotline nhà mạng theo cùng một luật số điện thoại. */
describe('CatalogBodyDto — phone / hotline', () => {
  it.each(['phone', 'hotline'] as const)('%s: bỏ dấu trình bày khi lưu, chặn ký tự lạ', async (field) => {
    const ok = plainToInstance(CatalogBodyDto, { [field]: '+84 28 3822 1234' });
    expect(await validate(ok)).toEqual([]);
    expect(ok[field]).toBe('+842838221234');

    const legacy = plainToInstance(CatalogBodyDto, { [field]: '(028) 3822-1234' });
    expect(await validate(legacy)).toEqual([]);
    expect(legacy[field]).toBe('02838221234');

    const bad = plainToInstance(CatalogBodyDto, { [field]: '028 3822 1234 (máy lẻ 5)' });
    const messages = (await validate(bad)).flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(PHONE_MESSAGE);
  });
});
