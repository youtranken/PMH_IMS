import { EnvelopeCryptoService } from './envelope.service';
import { MasterKeyRing } from './master-key-ring';

const KEY_V1 = '1'.repeat(64);
const KEY_V2 = '2'.repeat(64);
const CTX = { table: 'users', recordId: '11111111-1111-1111-1111-111111111111' };

function service(raw: string): EnvelopeCryptoService {
  return new EnvelopeCryptoService(new MasterKeyRing(raw));
}

describe('MasterKeyRing', () => {
  it('chọn version lớn nhất làm chìa hiện hành', () => {
    const ring = new MasterKeyRing(`1=${KEY_V1}\n2=${KEY_V2}`);
    expect(ring.currentVersion).toBe(2);
    expect(ring.versions).toEqual([1, 2]);
  });

  it.each([
    ['rỗng', ''],
    ['thiếu version', KEY_V1],
    ['khóa ngắn', '1=abcd'],
    ['khóa không phải hex', `1=${'z'.repeat(64)}`],
  ])('từ chối file %s', (_name, raw) => {
    expect(() => new MasterKeyRing(raw)).toThrow();
  });

  it('từ chối version khai trùng', () => {
    expect(() => new MasterKeyRing(`1=${KEY_V1}\n1=${KEY_V2}`)).toThrow(/trùng/);
  });

  it('bỏ qua dòng trống và dòng chú thích', () => {
    const ring = new MasterKeyRing(`# chìa quý 3\n\n1=${KEY_V1}\n`);
    expect(ring.currentVersion).toBe(1);
  });
});

describe('EnvelopeCryptoService — test vector (AR-9)', () => {
  it('mã hóa → giải mã ra đúng bản gốc', () => {
    const svc = service(`1=${KEY_V1}`);
    const sealed = svc.seal('P@ssw0rd-switch-tang-3', CTX);
    expect(svc.openText(sealed, CTX)).toBe('P@ssw0rd-switch-tang-3');
  });

  it('không bao giờ để lộ plaintext trong ciphertext', () => {
    const svc = service(`1=${KEY_V1}`);
    const sealed = svc.seal('admin123', CTX);
    expect(sealed.ciphertext.toString('utf8')).not.toContain('admin123');
    expect(sealed.ciphertext.length).toBeGreaterThan(0);
    expect(sealed.iv).toHaveLength(12);
    expect(sealed.tag).toHaveLength(16);
    expect(sealed.wrappedDek).toHaveLength(12 + 16 + 32);
  });

  it('hai lần mã cùng một chuỗi cho ciphertext khác nhau (IV + DEK ngẫu nhiên)', () => {
    const svc = service(`1=${KEY_V1}`);
    const a = svc.seal('cùng một mật khẩu', CTX);
    const b = svc.seal('cùng một mật khẩu', CTX);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedDek.equals(b.wrappedDek)).toBe(false);
  });

  it('AAD chặn bê ciphertext sang hàng khác', () => {
    const svc = service(`1=${KEY_V1}`);
    const sealed = svc.seal('bí mật của hàng A', CTX);
    expect(() =>
      svc.open(sealed, { table: 'users', recordId: 'hàng-khác' }),
    ).toThrow();
  });

  it('AAD chặn bê ciphertext sang bảng khác', () => {
    const svc = service(`1=${KEY_V1}`);
    const sealed = svc.seal('bí mật', CTX);
    expect(() => svc.open(sealed, { ...CTX, table: 'secret' })).toThrow();
  });

  it('sửa một bit ciphertext là giải mã hỏng (auth tag)', () => {
    const svc = service(`1=${KEY_V1}`);
    const sealed = svc.seal('không sửa được đâu', CTX);
    sealed.ciphertext[0] ^= 0x01;
    expect(() => svc.open(sealed, CTX)).toThrow();
  });

  it('sửa DEK bọc là giải mã hỏng', () => {
    const svc = service(`1=${KEY_V1}`);
    const sealed = svc.seal('không sửa được đâu', CTX);
    sealed.wrappedDek[20] ^= 0xff;
    expect(() => svc.open(sealed, CTX)).toThrow();
  });

  it('xoay key_version: chìa mới đọc được dữ liệu cũ, rewrap đưa lên version hiện hành', () => {
    const before = service(`1=${KEY_V1}`);
    const sealed = before.seal('mật khẩu Draytek', CTX);
    expect(sealed.keyVersion).toBe(1);

    // Thêm chìa v2 vào chùm, giữ nguyên v1 để đọc dữ liệu cũ.
    const after = service(`1=${KEY_V1}\n2=${KEY_V2}`);
    expect(after.openText(sealed, CTX)).toBe('mật khẩu Draytek');

    const rotated = after.rewrap(sealed, CTX);
    expect(rotated.keyVersion).toBe(2);
    expect(after.openText(rotated, CTX)).toBe('mật khẩu Draytek');
  });

  it('rewrap khi đã ở version hiện hành thì giữ nguyên', () => {
    const svc = service(`1=${KEY_V1}`);
    const sealed = svc.seal('x', CTX);
    expect(svc.rewrap(sealed, CTX)).toBe(sealed);
  });

  it('mất chìa cũ khỏi chùm thì dữ liệu cũ báo lỗi rõ ràng, không im lặng', () => {
    const before = service(`1=${KEY_V1}`);
    const sealed = before.seal('dữ liệu cũ', CTX);
    const onlyV2 = service(`2=${KEY_V2}`);
    expect(() => onlyV2.open(sealed, CTX)).toThrow(/master key version 1/i);
  });

  it('mã hóa được Buffer nhị phân (TOTP secret dạng byte)', () => {
    const svc = service(`1=${KEY_V1}`);
    const raw = Buffer.from([0x00, 0xff, 0x10, 0x42]);
    const sealed = svc.seal(raw, CTX);
    expect(svc.open(sealed, CTX).equals(raw)).toBe(true);
  });
});
