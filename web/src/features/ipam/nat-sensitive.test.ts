import { describe, expect, it } from 'vitest';
import { sensitivePortOf } from './nat-sensitive';

const PORTS = [22, 445, 3389];

describe('sensitivePortOf — rule mở một cổng nhạy cảm ra Internet', () => {
  it.each<[string, number, number | null]>([
    ['3389', 3389, 3389],
    // RDP đổi cổng ngoài vẫn là RDP: cổng TRONG mới nói dịch vụ là gì.
    ['33890', 3389, 3389],
    // Một dải ngoài trùm lên 22.
    ['20-25', 8080, 22],
    ['443', 443, null],
    ['8000-8010', 80, null],
  ])('ngoài %s → trong %s: %s', (external, internal, expected) => {
    expect(sensitivePortOf(external, internal, PORTS)).toBe(expected);
  });

  it('danh sách rỗng thì không rule nào nhạy cảm', () => {
    expect(sensitivePortOf('3389', 3389, [])).toBeNull();
  });
});
