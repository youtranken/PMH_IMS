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
class DtoMau {
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
   * Bản tiếng Anh trước 12/09 cũng sai y như vậy — chỉ khác là không ai đọc nó. Dịch xong thì
   * câu sai trở thành câu sai ĐỌC ĐƯỢC, và lượt lái tay 12/09 nhìn ra ngay.
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
async function cauLoiCho(payload: Record<string, unknown>): Promise<string[]> {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: true,
    exceptionFactory: (errors) => new BadRequestException(messagesOf(errors)),
  });
  try {
    await pipe.transform(payload, { type: 'body', metatype: DtoMau });
    return [];
  } catch (err) {
    const body = (err as BadRequestException).getResponse() as { message: string[] };
    return body.message;
  }
}

describe('Câu lỗi nhập liệu — tiếng Việt cho MỌI validator', () => {
  it('câu DTO tự khai thì THẮNG — nó biết chuyện cụ thể hơn bản dịch chung', async () => {
    const cau = await cauLoiCho({ deviceId: 'khong-phai-uuid' });
    expect(cau).toContain('Mã thiết bị không hợp lệ.');
  });

  it('validator KHÔNG khai message vẫn ra tiếng Việt, và giữ đúng con số', async () => {
    const cau = await cauLoiCho({ internalPort: 99999 });
    // Đây chính là câu lọt ra màn hình ở ô "Port trong" của form NAT trước 12/09:
    //   internalPort must not be greater than 65535
    expect(cau).toContain('Cổng trong không được lớn hơn 65535.');
  });

  it('Min giữ được mốc dưới', async () => {
    expect(await cauLoiCho({ seatTotal: 0 })).toContain('Tổng số ghế không được nhỏ hơn 1.');
  });

  /*
   * HAI CA NÀY ĐI ĐÔI, và cặp ấy mới là điều đáng giữ: cùng một trường phải nói ĐÚNG nguyên
   * nhân của mình. Thiếu ca "gõ chữ" thì đảo thứ tự decorator vẫn xanh — và câu lỗi quay về
   * nói sai lý do. Thiếu ca "quá to" thì một bản vá bỏ hẳn `@Max` cũng xanh.
   */
  it('gõ CHỮ vào ô số → nói là phải là số nguyên, KHÔNG nói là quá lớn', async () => {
    expect(await cauLoiCho({ internalPort: 'khong-phai-so' })).toContain(
      'Cổng trong phải là số nguyên.',
    );
  });

  it('số quá to vẫn nói đúng là quá to', async () => {
    expect(await cauLoiCho({ internalPort: 99999 })).toContain(
      'Cổng trong không được lớn hơn 65535.',
    );
  });

  it('Length phân biệt được vế ngắn và vế dài', async () => {
    expect(await cauLoiCho({ fullName: 'A' })).toContain('Họ tên tối thiểu 2 ký tự.');
    expect(await cauLoiCho({ fullName: 'A'.repeat(200) })).toContain('Họ tên tối đa 120 ký tự.');
  });

  it('MaxLength, IsIn, IsBoolean, IsEmail, Matches đều có câu tiếng Việt', async () => {
    expect(await cauLoiCho({ code: 'A'.repeat(50) })).toContain('Mã hồ sơ tối đa 10 ký tự.');
    expect(await cauLoiCho({ status: 'khong-co' })).toContain(
      'Trạng thái chỉ nhận một trong: active, locked, disabled.',
    );
    expect(await cauLoiCho({ enabled: 'co' })).toContain('Trạng thái bật/tắt chỉ nhận đúng hoặc sai.');
    expect(await cauLoiCho({ email: 'khong-phai-email' })).toContain('Email không hợp lệ.');
    expect(await cauLoiCho({ vlan: 'abc' })).toContain('VLAN sai định dạng.');
  });

  it('field lạ (forbidNonWhitelisted) nói rõ đây là lỗi phần mềm, không phải lỗi người nhập', async () => {
    const cau = await cauLoiCho({ khongCoTruongNay: 1 });
    expect(cau.join(' ')).toContain('lỗi của phần mềm');
    expect(cau.join(' ')).toContain('khongCoTruongNay');
  });

  /*
   * VẾ QUAN TRỌNG NHẤT: KHÔNG MỘT CÂU TIẾNG ANH NÀO LỌT RA.
   *
   * Năm câu trên kiểm từng loại; câu này kiểm cái LỚP — mọi câu đi ra khỏi pipe đều phải có
   * dấu tiếng Việt. Thiếu nó thì một ràng buộc chưa khai bản dịch vẫn lọt mà không ai thấy.
   */
  it('không câu nào còn là tiếng Anh', async () => {
    const moiCau = [
      ...(await cauLoiCho({ internalPort: 99999 })),
      ...(await cauLoiCho({ fullName: 'A' })),
      ...(await cauLoiCho({ status: 'x' })),
      ...(await cauLoiCho({ email: 'x' })),
      ...(await cauLoiCho({ khongCoTruongNay: 1 })),
      ...(await cauLoiCho({})),
    ];
    expect(moiCau.length).toBeGreaterThan(0);
    expect(moiCau.filter(isDefaultMessage)).toEqual([]);
  });
});

/*
 * ===== ĐIỂM DANH TRÊN MÃ NGUỒN THẬT =====
 *
 * Hai bài dưới đây đọc thẳng `*.controller.ts`. Chúng canh hai lối mà một câu tiếng Anh có thể
 * bò trở lại: một ràng buộc kiểu MỚI chưa có bản dịch, và một câu `message` viết không dấu
 * (làm hỏng chính quy ước "toàn ASCII = chưa dịch" mà `isDefaultMessage` dựa vào).
 */
const API_SRC = join(__dirname, '..');

function moiControllerFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return moiControllerFile(full);
    return e.isFile() && e.name.endsWith('.controller.ts') ? [full] : [];
  });
}

/** Decorator trong mã → khóa ràng buộc mà class-validator sinh ra. */
const KHOA_CUA_DECORATOR: Record<string, string> = {
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
  const nguon = moiControllerFile(API_SRC).map((f) => readFileSync(f, 'utf8'));

  it('đọc được mã nguồn controller (nếu không thì cả hai bài dưới vô nghĩa)', () => {
    expect(nguon.length).toBeGreaterThanOrEqual(15);
  });

  it('mọi loại ràng buộc đang dùng đều có bản dịch', () => {
    const dangDung = new Set<string>();
    for (const s of nguon) {
      for (const m of s.matchAll(/@([A-Z][A-Za-z]+)\(/g)) {
        const khoa = KHOA_CUA_DECORATOR[m[1]];
        if (khoa) dangDung.add(khoa);
      }
    }
    expect(dangDung.size).toBeGreaterThanOrEqual(10);

    // Nhánh `default` của `vietnameseFor` trả "<tên> không hợp lệ." — đúng ngữ pháp nhưng mất
    // hết thông tin. Ràng buộc nào rơi vào đó là ràng buộc chưa ai viết câu cho nó.
    const chuaDich = [...dangDung].filter(
      (khoa) => vietnameseFor('deviceId', khoa, 'x must be y') === 'Thiết bị không hợp lệ.',
    );
    expect(chuaDich.filter((k) => k !== 'isUuid')).toEqual([]);
  });

  it('mọi câu `message` khai tay đều có dấu tiếng Việt', () => {
    /*
     * Đây là vế giữ cho `isDefaultMessage` còn đúng. Một câu khai tay viết không dấu — kiểu
     * 'Ma thiet bi khong hop le' — sẽ bị coi là câu mặc định và BỊ THAY bằng bản dịch chung,
     * tức người viết mất câu của mình mà không hiểu vì sao.
     */
    const khongDau: string[] = [];
    for (const s of nguon) {
      for (const m of s.matchAll(/message:\s*'([^']+)'/g)) {
        if (isDefaultMessage(m[1])) khongDau.push(m[1]);
      }
    }
    expect(khongDau).toEqual([]);
  });

  it('mọi trường CÓ validator đều có nhãn tiếng Việt', () => {
    /*
     * Thiếu nhãn thì câu lỗi rơi về tên trường thô — "internalPort phải là số nguyên." Đọc
     * được, nhưng nửa Anh nửa Việt, và đó đúng là thứ mục #5 sinh ra để dẹp.
     */
    const thieu = new Set<string>();
    const thay = new Set<string>();
    for (const s of nguon) {
      // Một khối decorator (@...) đứng liền trước dòng khai trường.
      for (const m of s.matchAll(/@[A-Z][A-Za-z]+\([^\n]*\)\s*\n\s*([a-zA-Z][A-Za-z0-9]*)[!?]?:/g)) {
        thay.add(m[1]);
        if (!(m[1] in FIELD_LABEL)) thieu.add(m[1]);
      }
    }
    /*
     * SÀN CHỐNG REGEX HỤT — vế giữ cho cả bài có nghĩa. Đổi cách viết DTO làm regex trả rỗng,
     * và một bài "mọi trường tìm được đều có nhãn" sẽ XANH RỰC trong khi nó chẳng kiểm gì.
     *
     * 42 là SỐ ĐO ngày 12/09, không phải một con số tròn cho đẹp. Nó là số trường có decorator
     * đóng ngoặc NGAY TRÊN dòng khai — decorator viết nhiều dòng thì regex này không bắt, nên
     * 42 là mức sàn chứ không phải tổng số trường có validator. Sàn đặt thấp hơn một chút để
     * một lượt refactor đổi cách xuống dòng không làm đỏ vì lý do chẳng liên quan.
     */
    expect(thay.size).toBeGreaterThanOrEqual(40);
    expect([...thieu].sort()).toEqual([]);
  });
});
