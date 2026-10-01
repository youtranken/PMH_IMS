/**
 * Tông màu badge trạng thái của phần mềm, đường truyền, tài khoản dịch vụ — MỘT nơi khai (AD-15).
 *
 * Nằm ở `lib` chứ không trong `features/<module>` vì Kho thanh lý cũng tô badge bằng đúng các
 * bảng này (Q-19): một bản chép riêng ở kho sẽ lệch màu với màn gốc ngay lần đầu có người sửa.
 * Tông màu của thiết bị nằm ở `lib/device-types.ts` cùng lý do.
 *
 * Luật màu phần mềm: xanh = ổn, đỏ = cần làm gì đó, xám = đã ra khỏi vòng đời. Hết hạn vẫn đang
 * cài trên máy và đang trong ân hạn trước khi tự thanh lý (Q-13), nên nó đỏ, không xám như
 * Thanh lý.
 */
export const SOFTWARE_STATUS_TONE = {
  active: 'ok',
  expired_ok: 'danger',
  retired: 'muted',
} as const;

export const ISP_STATUS_TONE = {
  active: 'ok',
  suspended: 'warn',
  terminated: 'muted',
} as const;

export const SERVICE_ACCOUNT_STATUS_TONE = {
  active: 'ok',
  disabled: 'danger',
} as const;
