import { PasswordService } from './password.service';

/**
 * Argon2id + pepper (NFR-01, AD-8).
 *
 * CLAUDE.md ghi thẳng: "Lõi bảo mật (Argon2, TOTP chống replay, envelope AES-GCM + xoay
 * key_version, CSRF, lockout) — không có test thì không được merge." Bốn thứ kia đều có test
 * tốt; Argon2 và pepper thì KHÔNG có một dòng nào cho tới 28/08.
 *
 * Bài quan trọng nhất ở đây là "pepper sai thì mật khẩu ĐÚNG phải trượt" — đó là toàn bộ lý do
 * pepper tồn tại (dump DB rơi ra ngoài mà không kèm pepper thì hash vô dụng). Nếu ai đó sửa
 * `season()` bỏ pepper đi, mọi thứ khác trong hệ thống vẫn chạy y hệt và không gì đỏ.
 *
 * Argon2id 64 MiB nên mỗi lần băm tốn ~100ms — timeout rộng ra cho các ca có nhiều lần băm.
 */
jest.setTimeout(30_000);

const PEPPER = 'e2e-pepper-cuc-ky-dai-va-ngau-nhien-0123456789';
const OTHER_PEPPER = 'mot-pepper-khac-cung-du-dai-9876543210-abcdefgh';

describe('PasswordService', () => {
  const svc = new PasswordService(PEPPER);

  it('băm rồi kiểm lại chính mật khẩu đó phải đúng', async () => {
    const hashed = await svc.hash('Mat#Khau2026!ok');
    expect(await svc.verify(hashed, 'Mat#Khau2026!ok')).toBe(true);
  });

  it('mật khẩu sai phải trượt', async () => {
    const hashed = await svc.hash('Mat#Khau2026!ok');
    expect(await svc.verify(hashed, 'Mat#Khau2026!oK')).toBe(false);
    expect(await svc.verify(hashed, '')).toBe(false);
  });

  it('PEPPER SAI thì mật khẩu ĐÚNG cũng phải trượt — đây là lý do pepper tồn tại', async () => {
    const hashed = await svc.hash('Mat#Khau2026!ok');

    const kePhamCoDump = new PasswordService(OTHER_PEPPER);
    expect(await kePhamCoDump.verify(hashed, 'Mat#Khau2026!ok')).toBe(false);

    const khongCoPepper = new PasswordService('');
    expect(await khongCoPepper.verify(hashed, 'Mat#Khau2026!ok')).toBe(false);
  });

  it('hai lần băm cùng một mật khẩu ra hai hash khác nhau (salt ngẫu nhiên)', async () => {
    const a = await svc.hash('Mat#Khau2026!ok');
    const b = await svc.hash('Mat#Khau2026!ok');
    expect(a).not.toBe(b);
    // …nhưng cả hai đều kiểm lại đúng.
    expect(await svc.verify(a, 'Mat#Khau2026!ok')).toBe(true);
    expect(await svc.verify(b, 'Mat#Khau2026!ok')).toBe(true);
  });

  it('hash mang đúng tham số Argon2id đã chọn (64 MiB · t=3 · p=1)', async () => {
    const hashed = await svc.hash('Mat#Khau2026!ok');
    // Định dạng PHC: $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(hashed).toContain('m=65536');
    expect(hashed).toContain('t=3');
    expect(hashed).toContain('p=1');
  });

  it.each([
    ['chuỗi rác', 'khong-phai-hash'],
    ['rỗng', ''],
    ['giống PHC nhưng hỏng', '$argon2id$v=19$m=65536,t=3,p=1$xxx'],
  ])('verify với hash %s trả false chứ KHÔNG ném', async (_label, hashed) => {
    await expect(svc.verify(hashed, 'bat-ky')).resolves.toBe(false);
  });

  it('mật khẩu unicode và rất dài vẫn khứ hồi được', async () => {
    const plain = 'Mật khẩu Tiếng Việt #2026 ' + 'x'.repeat(150);
    const hashed = await svc.hash(plain);
    expect(await svc.verify(hashed, plain)).toBe(true);
    expect(await svc.verify(hashed, plain + 'x')).toBe(false);
  });

  describe('fromSecretFile — hàng rào độ dài pepper', () => {
    const ENV = 'PEPPER_FILE_TEST_ONLY';
    afterEach(() => {
      delete process.env[ENV];
    });

    it('pepper ngắn hơn 32 ký tự thì api PHẢI từ chối khởi động', () => {
      // `readSecretFile` chấp nhận giá trị inline khi biến môi trường không trỏ tới file;
      // nếu môi trường không hỗ trợ, ca này vẫn phải là "ném", không được im lặng đi tiếp.
      process.env[ENV] = 'qua-ngan';
      expect(() => PasswordService.fromSecretFile(ENV)).toThrow();
    });

    it('thiếu hẳn biến môi trường cũng phải ném, không tự bịa pepper rỗng', () => {
      expect(() => PasswordService.fromSecretFile(ENV)).toThrow();
    });
  });
});
