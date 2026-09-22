import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChangePasswordDto, TotpEnrollStartDto } from './auth.dto';

/**
 * HAI LỖI TRONG BỐN DÒNG DTO (§18 #9 và #11).
 *
 * DTO là cửa đầu tiên mọi request đi qua, và nó là chỗ hiếm hoi mà một lỗi nhỏ đổi hẳn NHÁNH
 * mà request rơi vào — chứ không chỉ đổi câu chữ.
 */

function errorsOf(cls: typeof TotpEnrollStartDto | typeof ChangePasswordDto, body: unknown) {
  return validateSync(plainToInstance(cls, body) as object, { whitelist: true });
}

describe('TotpEnrollStartDto — `null` không được giả làm "có gửi"', () => {
  /**
   * §18 #9 — `@IsOptional()` cho `null` ĐI QUA.
   *
   * `class-validator` coi `@IsOptional()` là "bỏ qua mọi luật khi giá trị là `undefined` HOẶC
   * `null`". Nên `{"currentPassword": null}` qua được DTO, rồi tới service:
   *
   *     if (currentPassword === undefined) → REAUTH_REQUIRED
   *
   * `null !== undefined`, nên nó KHÔNG rơi vào nhánh "chưa chứng minh lại mình" mà rơi xuống
   * `passwords.verify(hash, null)` — tức nhánh SAI MẬT KHẨU. Người dùng tiêu một lượt đoán
   * (và một dòng `auth.totp.enroll.reauth_failed` vào sổ) cho một request chưa hề gửi mật khẩu.
   *
   * Cùng hình dạng với `kind`/`licenseModel` bên software. Sửa ở DTO, không ở service: service
   * đã hỏi đúng câu của nó, cửa mới là chỗ để lọt một hình dạng không hợp lệ.
   */
  it('`null` bị TỪ CHỐI ở cửa DTO, không lọt xuống nhánh sai-mật-khẩu', () => {
    expect(errorsOf(TotpEnrollStartDto, { currentPassword: null })).not.toEqual([]);
  });

  it('VẮNG MẶT thì vẫn cho qua — đó là cả lý do `@IsOptional` có ở đây', () => {
    // Luồng đăng nhập bắt buộc cài 2 lớp được miễn gõ lại mật khẩu; ai được miễn là quyết
    // định của `AuthService`, không phải của DTO. Nên vắng mặt PHẢI qua được cửa này.
    expect(errorsOf(TotpEnrollStartDto, {})).toEqual([]);
  });

  it('chuỗi bình thường vẫn qua (vế đối chứng)', () => {
    expect(errorsOf(TotpEnrollStartDto, { currentPassword: 'mat-khau-cu' })).toEqual([]);
  });
});

describe('Câu lỗi `@Length` phải đúng cho CẢ HAI biên (§18 #11)', () => {
  /**
   * `@Length(1, 200, { message: 'Chưa nhập mật khẩu hiện tại.' })` gắn MỘT câu cho HAI nhánh.
   *
   * Chuỗi rỗng → "Chưa nhập mật khẩu hiện tại." — đúng.
   * Chuỗi 300 ký tự → cũng "Chưa nhập mật khẩu hiện tại." — SAI, và sai theo kiểu làm người
   * dùng bối rối nhất: họ vừa gõ một thứ rất dài và hệ thống bảo họ chưa gõ gì.
   *
   * Người dùng thật gặp ca này khi trình quản lý mật khẩu dán nhầm cả một khối.
   */
  it.each([
    [ChangePasswordDto, 'currentPassword'],
    [TotpEnrollStartDto, 'currentPassword'],
  ])('%#: quá dài thì KHÔNG nói "chưa nhập"', (cls, field) => {
    const errors = errorsOf(cls, {
      [field]: 'x'.repeat(300),
      newPassword: 'mat-khau-moi-du-dai',
    });
    const said = JSON.stringify(errors.map((e) => e.constraints));
    expect(said).not.toContain('Chưa nhập');
  });

  it('rỗng thì VẪN nói "chưa nhập" (vế đối chứng)', () => {
    const errors = errorsOf(ChangePasswordDto, {
      currentPassword: '',
      newPassword: 'mat-khau-moi-du-dai',
    });
    expect(JSON.stringify(errors.map((e) => e.constraints))).toContain('Chưa nhập');
  });
});
