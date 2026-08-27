import { describe, expect, it } from 'vitest';
import {
  chipsFromValue,
  isWideRange,
  parsePortChip,
  type ChipError,
  type PortChip,
} from './port-chips';

describe('parsePortChip — nhận đúng thứ API nhận, từ chối đúng thứ API từ chối', () => {
  const good: { input: string; value: string; from: number; to: number }[] = [
    { input: '8080', value: '8080', from: 8080, to: 8080 },
    { input: '  443  ', value: '443', from: 443, to: 443 },
    { input: '8000-8010', value: '8000-8010', from: 8000, to: 8010 },
    // Chép từ email nhà mạng hay dính khoảng trắng quanh dấu gạch.
    { input: '5060 - 5070', value: '5060-5070', from: 5060, to: 5070 },
    { input: '1', value: '1', from: 1, to: 1 },
    { input: '65535', value: '65535', from: 65535, to: 65535 },
    // Hai đầu bằng nhau thì thu về một số, không giữ "8080-8080".
    { input: '8080-8080', value: '8080', from: 8080, to: 8080 },
  ];

  for (const { input, value, from, to } of good) {
    it(`nhận "${input}" → ${value}`, () => {
      const result = parsePortChip(input);
      expect(result).toEqual({ chip: { value, from, to }, reason: null });
    });
  }

  const bad: { input: string; reason: ChipError }[] = [
    { input: '', reason: 'format' },
    { input: 'http', reason: 'format' },
    { input: '80,443', reason: 'format' },
    { input: '8080-', reason: 'format' },
    { input: '1.2', reason: 'format' },
    { input: '0', reason: 'range' },
    { input: '65536', reason: 'range' },
    { input: '70000-70010', reason: 'range' },
    // Đảo hai đầu là lỗi RIÊNG: người gõ biết mình muốn gì, chỉ viết ngược.
    { input: '9000-8000', reason: 'reversed' },
  ];

  for (const { input, reason } of bad) {
    it(`từ chối "${input}" vì ${reason}`, () => {
      expect(parsePortChip(input)).toEqual({ chip: null, reason });
    });
  }
});

describe('parsePortChip — chặn trùng ngay tại chỗ', () => {
  const existing: PortChip[] = [
    { value: '8080', from: 8080, to: 8080 },
    { value: '8000-8010', from: 8000, to: 8010 },
  ];

  it('thêm lại đúng khoảng đã có thì báo trùng', () => {
    expect(parsePortChip('8080', existing)).toEqual({ chip: null, reason: 'duplicate' });
  });

  it('viết khác nhưng cùng nghĩa vẫn bị bắt là trùng', () => {
    expect(parsePortChip('8080-8080', existing)).toEqual({ chip: null, reason: 'duplicate' });
    expect(parsePortChip('8000 - 8010', existing)).toEqual({ chip: null, reason: 'duplicate' });
  });

  it('khoảng khác thì vẫn thêm được', () => {
    expect(parsePortChip('8443', existing)).toEqual({
      chip: { value: '8443', from: 8443, to: 8443 },
      reason: null,
    });
  });

  // Chồng lấn KHÔNG chặn ở client: luật chồng port của API còn xét cả router và giao thức,
  // chép bản thứ hai sang đây là chép một nửa và sẽ trôi lệch.
  it('khoảng chồng lấn nhưng khác chuỗi thì client vẫn cho thêm', () => {
    expect(parsePortChip('8005-8020', existing).chip).not.toBeNull();
  });
});

describe('chipsFromValue — mở lại rule đang có', () => {
  it('một khoảng duy nhất (đúng dạng trong DB)', () => {
    expect(chipsFromValue('8080')).toEqual([{ value: '8080', from: 8080, to: 8080 }]);
  });

  it('danh sách ngăn bởi dấu phẩy', () => {
    expect(chipsFromValue('80,443,8000-8010')).toEqual([
      { value: '80', from: 80, to: 80 },
      { value: '443', from: 443, to: 443 },
      { value: '8000-8010', from: 8000, to: 8010 },
    ]);
  });

  it('chuỗi rỗng ra danh sách rỗng, không ném', () => {
    expect(chipsFromValue('')).toEqual([]);
    expect(chipsFromValue('   ')).toEqual([]);
  });

  // Dữ liệu hỏng trong DB không được cướp mất đường sửa nó.
  it('bỏ qua mẩu hỏng thay vì ném', () => {
    expect(chipsFromValue('8080,rác,443')).toEqual([
      { value: '8080', from: 8080, to: 8080 },
      { value: '443', from: 443, to: 443 },
    ]);
  });

  it('bỏ mẩu trùng, giữ lần xuất hiện đầu', () => {
    expect(chipsFromValue('8080,8080')).toEqual([{ value: '8080', from: 8080, to: 8080 }]);
  });
});

describe('isWideRange — cảnh báo mềm khi mở quá rộng', () => {
  const cases: { name: string; chip: PortChip; wide: boolean }[] = [
    { name: 'một port', chip: { value: '8080', from: 8080, to: 8080 }, wide: false },
    { name: 'đúng 1000 port thì chưa cảnh báo', chip: { value: '1-1000', from: 1, to: 1000 }, wide: false },
    { name: '1001 port thì cảnh báo', chip: { value: '1-1001', from: 1, to: 1001 }, wide: true },
    // Dải camera thật ở PMH — vẫn phải lưu được, chỉ là có nói ra.
    { name: 'dải camera 50000-52000', chip: { value: '50000-52000', from: 50000, to: 52000 }, wide: true },
  ];

  for (const { name, chip, wide } of cases) {
    it(name, () => {
      expect(isWideRange(chip)).toBe(wide);
    });
  }
});

/**
 * Dán cả danh sách vào ô port — phần CHƯA nhận được không được biến mất.
 *
 * `chipsFromValue` là hàm thuần đọc cả chuỗi (dùng khi mở lại rule đang có); phần "giữ lại
 * mẩu kẹt và mọi mẩu sau nó" nằm ở `PortChipsField`. Bảng dưới khóa hành vi của hàm thuần,
 * còn hành vi của ô nhập có bài E2E riêng.
 */
describe('chipsFromValue — mẩu hỏng không kéo theo mẩu đúng đứng sau', () => {
  const cases: { input: string; values: string[] }[] = [
    { input: '80,rác,443', values: ['80', '443'] },
    { input: '80, 443, 8000-8010', values: ['80', '443', '8000-8010'] },
    // Mẩu hỏng ở ĐẦU cũng không được nuốt phần còn lại.
    { input: 'rác,80,443', values: ['80', '443'] },
    { input: '9000-8000, 443', values: ['443'] },
  ];

  for (const { input, values } of cases) {
    it(`"${input}" → ${values.join(', ') || '(rỗng)'}`, () => {
      expect(chipsFromValue(input).map((chip) => chip.value)).toEqual(values);
    });
  }
});
