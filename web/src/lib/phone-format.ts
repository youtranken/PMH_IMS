/**
 * Số điện thoại tách nhóm để đọc (Q-18). Server lưu số liền (bỏ dấu cách), nên mọi chỗ HIỂN
 * THỊ đi qua đây; ô nhập và link `tel:` vẫn dùng số liền.
 *
 * Chỉ tách những dạng số Việt Nam nhận ra chắc chắn; dạng lạ (số ngắn 113, số quốc tế khác)
 * trả nguyên văn — tách sai một số còn khó đọc hơn không tách.
 */
function groups(digits: string, sizes: number[]): string {
  const out: string[] = [];
  let at = 0;
  for (const size of sizes) {
    out.push(digits.slice(at, at + size));
    at += size;
  }
  return out.join(' ');
}

function formatNational(digits: string): string | null {
  if (/^1[89]00\d{4}$/.test(digits)) return groups(digits, [4, 4]);
  if (/^1[89]00\d{6}$/.test(digits)) return groups(digits, [4, 4, 2]);
  if (/^02\d{9}$/.test(digits)) return groups(digits, [3, 4, 4]);
  if (/^0\d{9}$/.test(digits)) return groups(digits, [4, 3, 3]);
  return null;
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '');
  if (compact.startsWith('+84')) {
    const national = formatNational(`0${compact.slice(3)}`);
    return national ? `+84 ${national.slice(1)}` : raw;
  }
  return formatNational(compact) ?? raw;
}

/** Số cho link `tel:` — chỉ chữ số và dấu `+`. */
export function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, '')}`;
}
