/**
 * Ghi chú của ngăn két có lộ bí mật không (Q-18, FR-035) — hàm thuần, có bảng test.
 *
 * Ghi chú là cột dạng rõ: không mã hoá, không đòi mã 6 số, không để lại dòng "đã xem" trong
 * nhật ký. Mật khẩu lọt vào đó là đi vòng qua toàn bộ két. Nên server CHẶN, không chỉ nhắc.
 */

/**
 * Giá trị ngắn hơn ngưỡng này chỉ bị chặn khi ghi chú Y HỆT nó: tìm "admin" hay "1234" bên
 * trong một câu thì câu nào cũng dính, và người dùng sẽ học cách lách chứ không học luật.
 */
export const NOTE_VALUE_MIN_LENGTH = 6;

/** Bỏ khoảng trắng + hạ chữ thường: "Cisco # Core" và "cisco#core" là một chuỗi với người đọc. */
function squash(text: string): string {
  return text.replace(/\s+/g, '').toLowerCase();
}

/** Ghi chú có chứa chính giá trị đang cất không. So được khi cả hai cùng nằm trong request. */
export function noteContainsSecret(note: string | null | undefined, value: string): boolean {
  const n = squash(note ?? '');
  const v = squash(value);
  if (!n || !v) return false;
  if (n === v) return true;
  return v.length >= NOTE_VALUE_MIN_LENGTH && n.includes(v);
}
