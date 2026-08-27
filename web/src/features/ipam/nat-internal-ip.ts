/**
 * Luật của ô "IP trong" trên form NAT — tách khỏi component để test bằng bảng dữ liệu.
 *
 * Vì sao ô này cần luật riêng: **"Máy đích" là BỘ LỌC, không phải dữ liệu được ghi.** Máy đích
 * của một rule do API suy ra từ hồ sơ IP (`internalDeviceId: ip?.deviceId`), client không gửi
 * lên. Nên chọn máy A rồi để địa chỉ của máy B nằm trong ô là cuốn sổ ghi về B — không một lời
 * nào — trong khi người khai vẫn tin mình vừa mở port cho A.
 *
 * Kiểm ở đây là hàng rào TRƯỚC, không phải hàng rào duy nhất: `validateNatRule` bên API vẫn
 * phán cuối. Nhưng lỗi này API không bắt được — nó nhìn thấy một cặp (IP, máy) hoàn toàn hợp
 * lệ, chỉ không phải cặp mà người khai tưởng.
 */

/** Khóa i18n (bỏ tiền tố `nat.`) của lời báo, hoặc `null` khi ô hợp lệ. */
export type InternalIpProblem = 'internalIpRequired' | 'internalIpNotOfTarget' | null;

export interface InternalIpCheck {
  /** Địa chỉ đã cắt khoảng trắng — thứ sẽ gửi lên API. */
  value: string;
  reason: InternalIpProblem;
}

/**
 * Một hình dạng duy nhất (`{ value, reason }`), không dùng union phân biệt bằng cờ `ok`:
 * `tsconfig.app.json` của web không bật `strict` nên TS không thu hẹp được union theo boolean.
 * Cùng lý do đã ghi ở `port-chips.ts`.
 */
export function checkInternalIp(input: {
  /** Nội dung ô "IP trong". */
  internalIp: string;
  /** Máy đích đang chọn; rỗng = chưa chọn máy nào. */
  targetId: string;
  /** Địa chỉ trong hồ sơ IP của MÁY ĐANG CHỌN. Rỗng = máy chưa khai IP, hoặc chưa chọn máy. */
  targetIps: string[];
}): InternalIpCheck {
  const value = input.internalIp.trim();

  /*
   * Ô này `required` của trình duyệt KHÔNG che được: khi đã chọn máy đích nó thành `Select`,
   * mà `required` trên select rỗng thì trình duyệt bỏ qua. Thiếu chốt này là bỏ trống IP rồi
   * bấm Lưu sẽ bắn MỘT lượt POST hỏng cho MỖI chip port trước khi hiện lỗi gộp.
   */
  if (!value) return { value, reason: 'internalIpRequired' };

  /*
   * Máy đích chưa khai IP nào (`targetIps` rỗng) thì VẪN cho gõ tay — có máy chưa kịp khai —
   * nhưng form nói riêng ở dưới ô rằng rule sẽ không gắn về máy vừa chọn. Chỉ khi biết chắc
   * máy đó có những địa chỉ nào mà địa chỉ đang gõ không nằm trong đó thì mới chặn.
   */
  if (input.targetId && input.targetIps.length > 0 && !input.targetIps.includes(value)) {
    return { value, reason: 'internalIpNotOfTarget' };
  }

  return { value, reason: null };
}
