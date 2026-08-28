import { describe, expect, it } from 'vitest';
import { checkInternalIp, type InternalIpProblem } from './nat-internal-ip';

/**
 * Bài kiểm cho hàng rào "địa chỉ phải thuộc chính máy đích".
 *
 * Lỗi mà nó chặn là loại API KHÔNG bắt được: cặp (IP, máy) hoàn toàn hợp lệ, chỉ không phải
 * cặp người khai tưởng. Cuốn sổ ghi rule về máy chủ hồ sơ IP, còn người khai nhớ mình vừa mở
 * port cho máy vừa chọn trong ô "Máy đích" — hai câu khác nhau, không ai đối chiếu.
 */
describe('checkInternalIp — ô IP trong của form NAT', () => {
  const A_IPS = ['172.16.10.5', '172.16.10.6'];

  const cases: {
    name: string;
    internalIp: string;
    targetId: string;
    targetIps: string[];
    reason: InternalIpProblem;
  }[] = [
    // Bỏ trống — `required` của trình duyệt không che được vì ô này là `Select` khi đã chọn máy.
    { name: 'để trống', internalIp: '', targetId: '', targetIps: [], reason: 'internalIpRequired' },
    {
      name: 'chỉ có khoảng trắng',
      internalIp: '   ',
      targetId: 'A',
      targetIps: A_IPS,
      reason: 'internalIpRequired',
    },
    // Chưa chọn máy đích: gõ tay gì cũng được, hàng rào này không có ý kiến.
    {
      name: 'chưa chọn máy đích thì không chặn',
      internalIp: '10.0.0.9',
      targetId: '',
      targetIps: [],
      reason: null,
    },
    // Máy chưa khai IP nào: VẪN cho gõ (form nói riêng ở dưới ô là rule sẽ không gắn về máy đó).
    {
      name: 'máy đích chưa có hồ sơ IP thì vẫn cho gõ tay',
      internalIp: '10.0.0.9',
      targetId: 'A',
      targetIps: [],
      reason: null,
    },
    // Đúng cặp — đường hạnh phúc.
    {
      name: 'địa chỉ thuộc chính máy đích',
      internalIp: '172.16.10.5',
      targetId: 'A',
      targetIps: A_IPS,
      reason: null,
    },
    {
      name: 'khoảng trắng thừa hai đầu vẫn khớp',
      internalIp: '  172.16.10.6  ',
      targetId: 'A',
      targetIps: A_IPS,
      reason: null,
    },
    // Đây là chỗ hàng rào sinh ra để chặn: địa chỉ của MÁY KHÁC.
    {
      name: 'địa chỉ của máy khác',
      internalIp: '172.16.10.77',
      targetId: 'A',
      targetIps: A_IPS,
      reason: 'internalIpNotOfTarget',
    },
    // Gần đúng cũng là sai: một chữ số lệch là một cái máy khác hẳn.
    {
      name: 'lệch đúng một chữ số',
      internalIp: '172.16.10.55',
      targetId: 'A',
      targetIps: A_IPS,
      reason: 'internalIpNotOfTarget',
    },
  ];

  for (const { name, internalIp, targetId, targetIps, reason } of cases) {
    it(`${name} → ${reason ?? 'hợp lệ'}`, () => {
      expect(checkInternalIp({ internalIp, targetId, targetIps })).toEqual({
        value: internalIp.trim(),
        reason,
      });
    });
  }
});
