import { describe, expect, it } from 'vitest';
import { lowerFirstAfterNumber } from './count-label';

/* Q-24: nhãn đếm viết hoa vì nó thường đứng đầu cụm ("1 Tủ mạng"). Ghép vào GIỮA câu thì danh
   từ trở lại chữ thường; chữ viết tắt (IP, NAT) không bị đụng. */
describe('lowerFirstAfterNumber', () => {
  it.each([
    ['1 Tủ mạng', '1 tủ mạng'],
    ['12 Thiết bị · 1 Dải IP', '12 thiết bị · 1 dải IP'],
    ['3 License', '3 license'],
    ['2 Dây', '2 dây'],
    ['1 IP', '1 IP'],
    ['4 NAT', '4 NAT'],
    ['1.200 Thiết bị', '1.200 thiết bị'],
    ['Chưa dùng', 'Chưa dùng'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(lowerFirstAfterNumber(input)).toBe(expected);
  });
});
