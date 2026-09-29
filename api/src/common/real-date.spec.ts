import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsOptional, Validate } from 'class-validator';
import { allControllers } from '../test/source-text';
import { isRealDateOnly, RealDate, RealDateOrEmpty } from './real-date';

describe('isRealDateOnly — ngày lịch có thật dạng YYYY-MM-DD', () => {
  it.each([
    ['2026-02-28', true],
    ['2028-02-29', true], // năm nhuận
    ['2000-02-29', true], // chia hết 400 vẫn nhuận
    ['2026-12-31', true],
    ['2026-01-01', true],
    ['2026-02-29', false], // không nhuận
    ['1900-02-29', false], // chia hết 100 mà không chia hết 400
    ['2026-02-30', false],
    ['2026-04-31', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-01-00', false],
    ['2026-1-01', false],
    ['2026-01-01T00:00:00Z', false],
    [' 2026-01-01', false],
    ['', false],
    ['abc', false],
  ])('%j → %s', (value, expected) => {
    expect(isRealDateOnly(value)).toBe(expected);
  });
});

class OptionalDateDto {
  @IsOptional() @Validate(RealDateOrEmpty, { message: 'Ngày mua phải là ngày có thật.' })
  purchaseDate?: string;
}

class RequiredDateDto {
  @Validate(RealDate, { message: 'Hạn mới phải là ngày có thật.' })
  endDate!: string;
}

async function errorsOf<T extends object>(cls: new () => T, payload: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, payload));
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('RealDateOrEmpty / RealDate trên DTO', () => {
  it.each([
    [{}, []],
    [{ purchaseDate: '' }, []],
    [{ purchaseDate: '2026-03-01' }, []],
    [{ purchaseDate: '2026-02-30' }, ['Ngày mua phải là ngày có thật.']],
    [{ purchaseDate: 20260301 }, ['Ngày mua phải là ngày có thật.']],
  ])('ô tùy chọn %j', async (payload, expected) => {
    expect(await errorsOf(OptionalDateDto, payload)).toEqual(expected);
  });

  it.each([
    [{ endDate: '2027-01-31' }, []],
    [{ endDate: '' }, ['Hạn mới phải là ngày có thật.']],
    [{ endDate: '2027-02-31' }, ['Hạn mới phải là ngày có thật.']],
    [{}, ['Hạn mới phải là ngày có thật.']],
  ])('ô bắt buộc %j', async (payload, expected) => {
    expect(await errorsOf(RequiredDateDto, payload)).toEqual(expected);
  });
});

describe('Không controller nào còn kiểm ngày chỉ bằng regex', () => {
  /*
   * `@Matches(/^\d{4}-\d{2}-\d{2}$/)` nhận `2026-02-30`, cột `date` của Postgres thì không
   * (22008) — và người dùng nhận 500 thay vì câu tiếng Việt. Regex khuôn ngày trong DTO là dấu
   * hiệu đã quên kiểm ngày có thật.
   */
  it('mọi *.controller.ts', () => {
    const offenders = allControllers(join(__dirname, '..', 'modules')).filter((file) =>
      /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
