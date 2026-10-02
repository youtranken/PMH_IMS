import { describe, expect, it } from 'vitest';
import { wanIpIssues, wanIpsPayload } from './wan-ips';

/* Q-20: một đường truyền có nhiều IP WAN, mỗi dòng một IPv4 đơn — không nhận dải. */
describe('wanIpIssues — lỗi của từng dòng IP WAN', () => {
  it.each([
    [['113.161.10.20'], [null]],
    [[' 113.161.10.20 ', ''], [null, null]],
    [['113.161.10.16/29'], ['range']],
    [['203.0.113.10/32'], ['range']],
    [['động', '113.161.10', '010.1.1.1', '2001:db8::1'], ['invalid', 'invalid', 'invalid', 'invalid']],
    [['1.1.1.1', '2.2.2.2', ' 1.1.1.1'], [null, null, 'duplicate']],
  ])('%j → %j', (entries, issues) => {
    expect(wanIpIssues(entries)).toEqual(issues);
  });
});

describe('wanIpsPayload — thứ gửi lên API', () => {
  it('cắt khoảng trắng, bỏ dòng trống, giữ thứ tự', () => {
    expect(wanIpsPayload([' 2.2.2.2', '', '1.1.1.1 ', '   '])).toEqual(['2.2.2.2', '1.1.1.1']);
  });
});
