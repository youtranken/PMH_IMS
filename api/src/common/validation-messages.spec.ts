import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { FIELD_LABEL, isDefaultMessage, messagesOf, vietnameseFor } from './validation-messages';

/**
 * ===== VÌ SAO BÀI NÀY CHẠY `ValidationPipe` THẬT =====
 *
 * `vietnameseFor` đọc NGƯỢC các mốc (độ dài, min/max, danh sách cho phép) ra từ chính câu mặc
 * định của class-validator — `ValidationError` chỉ đưa câu đã dựng xong, không đưa tham số của
 * decorator. Nghĩa là bản dịch phụ thuộc vào cách THƯ VIỆN viết câu, một thứ có thể đổi ở bản
 * nâng cấp sau.
 *
 * Nên bài này không kiểm giả định của tôi về class-validator; nó cho pipe thật chạy trên DTO
 * thật rồi so câu đầu ra. Nâng cấp thư viện mà câu mặc định đổi chữ thì chỗ này đỏ NGAY, kèm
 * đúng câu sai — thay vì lặng lẽ trả về "Port trong vượt quá mức cho phép" và mất mất con số.
 */
class SampleDto {
  @IsUUID(undefined, { message: 'Mã thiết bị không hợp lệ.' })
  deviceId!: string;

  /*
   * ===== `@IsInt()` PHẢI ĐỨNG SÁT TÊN TRƯỜNG =====
   *
   * Với `stopAtFirstError: true`, class-validator báo ĐÚNG MỘT ràng buộc cho mỗi trường, và
   * nó chọn cái gần thuộc tính nhất. Đặt `@IsInt()` ở TRÊN `@Max()` thì gõ chữ vào ô số nhận
   * được "Port trong không được lớn hơn 65535." — một câu SAI về nguyên nhân: giá trị không
   * quá to, nó không phải số. (`Number('abc')` ra `NaN`, và `NaN <= 65535` là `false`, nên
   * `max` hỏng trước.)
   *
   * Câu tiếng Anh gốc của class-validator cũng sai y như vậy — chỉ khác là không ai đọc nó.
   * Dịch ra thì câu sai trở thành câu sai ĐỌC ĐƯỢC, nên phải chỉnh thứ tự cho đúng.
   *
   * Thứ tự dưới đây khớp 12 trường `@IsInt()` trong `*.controller.ts`. Hai ca kiểm bên dưới
   * giữ nó — đảo lại là đỏ.
   */
  @Max(65535)
  @IsInt()
  internalPort!: number;

  @Min(1)
  @IsInt()
  seatTotal!: number;

  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsString()
  @MaxLength(10)
  code!: string;

  @IsIn(['active', 'locked', 'disabled'])
  status!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsEmail()
  email!: string;

  @Matches(/^\d+$/)
  vlan!: string;
}

/** Chạy pipe thật, trả về danh sách câu lỗi y như client sẽ nhận. */
async function errorMessagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: true,
    exceptionFactory: (errors) => new BadRequestException(messagesOf(errors)),
  });
  try {
    await pipe.transform(payload, { type: 'body', metatype: SampleDto });
    return [];
  } catch (err) {
    const body = (err as BadRequestException).getResponse() as { message: string[] };
    return body.message;
  }
}

describe('Câu lỗi nhập liệu — tiếng Việt cho MỌI validator', () => {
  it('câu DTO tự khai thì THẮNG — nó biết chuyện cụ thể hơn bản dịch chung', async () => {
    const messages = await errorMessagesFor({ deviceId: 'khong-phai-uuid' });
    expect(messages).toContain('Mã thiết bị không hợp lệ.');
  });

  it('validator KHÔNG khai message vẫn ra tiếng Việt, và giữ đúng con số', async () => {
    const messages = await errorMessagesFor({ internalPort: 99999 });
    // Không dịch thì đây là câu lọt ra màn hình ở ô "Port trong" của form NAT:
    //   internalPort must not be greater than 65535
    expect(messages).toContain('Cổng trong không được lớn hơn 65535.');
  });

  it('Min giữ được mốc dưới', async () => {
    expect(await errorMessagesFor({ seatTotal: 0 })).toContain('Tổng số ghế không được nhỏ hơn 1.');
  });

  /*
   * HAI CA NÀY ĐI ĐÔI, và cặp ấy mới là điều đáng giữ: cùng một trường phải nói ĐÚNG nguyên
   * nhân của mình. Thiếu ca "gõ chữ" thì đảo thứ tự decorator vẫn xanh — và câu lỗi quay về
   * nói sai lý do. Thiếu ca "quá to" thì một bản vá bỏ hẳn `@Max` cũng xanh.
   */
  it('gõ CHỮ vào ô số → nói là phải là số nguyên, KHÔNG nói là quá lớn', async () => {
    expect(await errorMessagesFor({ internalPort: 'khong-phai-so' })).toContain(
      'Cổng trong phải là số nguyên.',
    );
  });

  it('số quá to vẫn nói đúng là quá to', async () => {
    expect(await errorMessagesFor({ internalPort: 99999 })).toContain(
      'Cổng trong không được lớn hơn 65535.',
    );
  });

  it('Length phân biệt được vế ngắn và vế dài', async () => {
    expect(await errorMessagesFor({ fullName: 'A' })).toContain('Họ tên tối thiểu 2 ký tự.');
    expect(await errorMessagesFor({ fullName: 'A'.repeat(200) })).toContain('Họ tên tối đa 120 ký tự.');
  });

  it('MaxLength, IsIn, IsBoolean, IsEmail, Matches đều có câu tiếng Việt', async () => {
    expect(await errorMessagesFor({ code: 'A'.repeat(50) })).toContain('Mã hồ sơ tối đa 10 ký tự.');
    expect(await errorMessagesFor({ status: 'khong-co' })).toContain(
      'Trạng thái chỉ nhận một trong: active, locked, disabled.',
    );
    expect(await errorMessagesFor({ enabled: 'co' })).toContain('Trạng thái bật/tắt chỉ nhận đúng hoặc sai.');
    expect(await errorMessagesFor({ email: 'khong-phai-email' })).toContain('Email không hợp lệ.');
    expect(await errorMessagesFor({ vlan: 'abc' })).toContain('VLAN sai định dạng.');
  });

  it('field lạ (forbidNonWhitelisted) nói rõ đây là lỗi phần mềm, không phải lỗi người nhập', async () => {
    const messages = await errorMessagesFor({ unknownField: 1 });
    expect(messages.join(' ')).toContain('lỗi của phần mềm');
    expect(messages.join(' ')).toContain('unknownField');
  });

  /*
   * VẾ QUAN TRỌNG NHẤT: KHÔNG MỘT CÂU TIẾNG ANH NÀO LỌT RA.
   *
   * Năm câu trên kiểm từng loại; câu này kiểm cái LỚP — mọi câu đi ra khỏi pipe đều phải có
   * dấu tiếng Việt. Thiếu nó thì một ràng buộc chưa khai bản dịch vẫn lọt mà không ai thấy.
   */
  it('không câu nào còn là tiếng Anh', async () => {
    const allMessages = [
      ...(await errorMessagesFor({ internalPort: 99999 })),
      ...(await errorMessagesFor({ fullName: 'A' })),
      ...(await errorMessagesFor({ status: 'x' })),
      ...(await errorMessagesFor({ email: 'x' })),
      ...(await errorMessagesFor({ unknownField: 1 })),
      ...(await errorMessagesFor({})),
    ];
    expect(allMessages.length).toBeGreaterThan(0);
    expect(allMessages.filter(isDefaultMessage)).toEqual([]);
  });
});

/*
 * ===== ĐIỂM DANH TRÊN MÃ NGUỒN THẬT =====
 *
 * Hai bài dưới đây đọc thẳng `*.controller.ts` và `*.dto.ts`. Chúng canh hai lối mà một câu tiếng Anh có thể
 * bò trở lại: một ràng buộc kiểu MỚI chưa có bản dịch, và một câu `message` viết không dấu
 * (làm hỏng chính quy ước "toàn ASCII = chưa dịch" mà `isDefaultMessage` dựa vào).
 */
const API_SRC = join(__dirname, '..');

function allControllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return allControllerFiles(full);
    // DTO tách riêng (`auth.dto.ts`) cũng đi qua cùng `ValidationPipe` — bỏ sót chúng là để lọt
    // đúng những trường của màn đăng nhập/đổi mật khẩu.
    return e.isFile() && /\.(controller|dto)\.ts$/.test(e.name) ? [full] : [];
  });
}

/** Decorator trong mã → khóa ràng buộc mà class-validator sinh ra. */
const DECORATOR_KEYS: Record<string, string> = {
  IsString: 'isString',
  IsInt: 'isInt',
  IsNumber: 'isNumber',
  IsBoolean: 'isBoolean',
  IsArray: 'isArray',
  IsUUID: 'isUuid',
  IsEmail: 'isEmail',
  IsDateString: 'isDateString',
  IsNotEmpty: 'isNotEmpty',
  IsIn: 'isIn',
  Length: 'isLength',
  MaxLength: 'maxLength',
  MinLength: 'minLength',
  Min: 'min',
  Max: 'max',
  Matches: 'matches',
};

describe('Điểm danh trên mã nguồn controller', () => {
  const source = allControllerFiles(API_SRC).map((f) => readFileSync(f, 'utf8'));

  it('đọc được mã nguồn controller (nếu không thì cả hai bài dưới vô nghĩa)', () => {
    expect(source.length).toBeGreaterThanOrEqual(15);
  });

  it('mọi loại ràng buộc đang dùng đều có bản dịch', () => {
    const inUse = new Set<string>();
    for (const s of source) {
      for (const m of s.matchAll(/@([A-Z][A-Za-z]+)\(/g)) {
        const key = DECORATOR_KEYS[m[1]];
        if (key) inUse.add(key);
      }
    }
    expect(inUse.size).toBeGreaterThanOrEqual(10);

    // Nhánh `default` của `vietnameseFor` trả "<tên> không hợp lệ." — đúng ngữ pháp nhưng mất
    // hết thông tin. Ràng buộc nào rơi vào đó là ràng buộc chưa ai viết câu cho nó.
    const untranslated = [...inUse].filter(
      (key) => vietnameseFor('deviceId', key, 'x must be y') === 'Thiết bị không hợp lệ.',
    );
    expect(untranslated.filter((k) => k !== 'isUuid')).toEqual([]);
  });

  it('mọi câu `message` khai tay đều có dấu tiếng Việt', () => {
    /*
     * Đây là vế giữ cho `isDefaultMessage` còn đúng. Một câu khai tay viết không dấu — kiểu
     * 'Ma thiet bi khong hop le' — sẽ bị coi là câu mặc định và BỊ THAY bằng bản dịch chung,
     * tức người viết mất câu của mình mà không hiểu vì sao.
     */
    const missingDiacritics: string[] = [];
    for (const s of source) {
      for (const m of s.matchAll(/message:\s*'([^']+)'/g)) {
        if (isDefaultMessage(m[1])) missingDiacritics.push(m[1]);
      }
    }
    expect(missingDiacritics).toEqual([]);
  });

  it('mọi trường CÓ validator đều có nhãn tiếng Việt', () => {
    /*
     * Thiếu nhãn thì câu lỗi rơi về tên trường thô — "internalPort phải là số nguyên." Đọc
     * được, nhưng nửa Anh nửa Việt, và đó đúng là thứ mục #5 sinh ra để dẹp.
     */
    const missing = new Set<string>();
    const observed = new Set<string>();
    for (const s of source) {
      // Một khối decorator (@...) đứng liền trước dòng khai trường.
      for (const m of s.matchAll(/@[A-Z][A-Za-z]+\([^\n]*\)\s*\n\s*([a-zA-Z][A-Za-z0-9]*)[!?]?:/g)) {
        observed.add(m[1]);
        if (!(m[1] in FIELD_LABEL)) missing.add(m[1]);
      }
    }
    /*
     * SÀN CHỐNG REGEX HỤT — vế giữ cho cả bài có nghĩa. Đổi cách viết DTO làm regex trả rỗng,
     * và một bài "mọi trường tìm được đều có nhãn" sẽ XANH RỰC trong khi nó chẳng kiểm gì.
     *
     * 42 là SỐ ĐO thật, không phải một con số tròn cho đẹp. Nó là số trường có decorator
     * đóng ngoặc NGAY TRÊN dòng khai — decorator viết nhiều dòng thì regex này không bắt, nên
     * 42 là mức sàn chứ không phải tổng số trường có validator. Sàn đặt thấp hơn một chút để
     * một lượt refactor đổi cách xuống dòng không làm đỏ vì lý do chẳng liên quan.
     */
    expect(observed.size).toBeGreaterThanOrEqual(40);
    expect([...missing].sort()).toEqual([]);
  });
});
