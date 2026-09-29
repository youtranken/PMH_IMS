/**
 * Ô "port ngoài" dạng CHIP — bản đọc của `parsePortRange` phía API
 * (`api/src/modules/ipam/nat-rules.ts`).
 *
 * Vì sao cần: một rule trong DB chỉ mang MỘT khoảng port. Nhưng việc thật hay gặp là "mở
 * 8080, 8443 và 5060-5070 cho cùng một máy, cùng một lý do" — trước đây phải mở form ba lần
 * và gõ lại router / IP trong / ai dùng / lý do ba lượt, sai một chỗ là ba dòng lệch nhau.
 *
 * Nên form nhận NHIỀU chip, mỗi chip một khoảng, rồi lưu ra nhiều rule dùng chung phần còn
 * lại. Client kiểm trước cho người gõ sửa ngay tại chỗ; API vẫn là nơi phán cuối.
 */
export interface PortChip {
  /** Dạng chuẩn để gửi lên API: "8080" hoặc "8000-8010". */
  value: string;
  from: number;
  to: number;
}

export type ChipError = 'format' | 'range' | 'reversed' | 'duplicate';

/**
 * Kết quả đọc một khoảng: đúng thì có `chip`, sai thì có `reason` — không bao giờ cả hai.
 *
 * Cố ý KHÔNG dùng union phân biệt bằng cờ `ok`. `tsconfig.app.json` của web không bật
 * `strict`, nên `strictNullChecks` tắt và TS không thu hẹp được union theo cờ boolean —
 * `if (!r.ok) r.reason` báo lỗi biên dịch dù logic đúng (bắt được lúc `npm run build`, còn
 * `tsc --noEmit` ở thư mục web thì không kiểm gì vì tsconfig gốc chỉ là file references).
 * Một hình dạng duy nhất thì không cần thu hẹp.
 */
export interface ParseChip {
  chip: PortChip | null;
  reason: ChipError | null;
}

function inPortRange(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * Nhận "8080" hoặc "8000-8010"; khoảng trắng quanh dấu gạch cũng chấp nhận vì người ta hay
 * gõ "8000 - 8010" khi chép từ email của nhà mạng.
 */
export function parsePortChip(input: string, existing: PortChip[] = []): ParseChip {
  const text = input.trim().replace(/\s*-\s*/, '-');
  const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(text);
  if (!match) return { chip: null, reason: 'format' };

  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (!inPortRange(from) || !inPortRange(to)) return { chip: null, reason: 'range' };
  if (from > to) return { chip: null, reason: 'reversed' };

  const value = from === to ? String(from) : `${from}-${to}`;
  // Thêm hai lần cùng một khoảng thì lưu ra hai rule trùng nhau, và API sẽ từ chối cái thứ
  // hai vì chồng port — chặn ngay ở đây thì người gõ biết lý do, không phải đoán qua lỗi 400.
  if (existing.some((chip) => chip.value === value)) {
    return { chip: null, reason: 'duplicate' };
  }
  return { chip: { value, from, to }, reason: null };
}

/**
 * Tách chuỗi port của một rule ĐANG CÓ thành chip để mở form sửa.
 *
 * Chuỗi trong DB luôn là một khoảng duy nhất; hàm này vẫn nhận danh sách ngăn bởi dấu phẩy
 * để mở lại được thứ chính form này vừa gõ ra, và bỏ qua mẩu hỏng thay vì ném — mở hộp sửa
 * mà nổ vì một ký tự lạ trong DB thì người dùng mất luôn đường sửa nó.
 */
export function chipsFromValue(value: string): PortChip[] {
  const chips: PortChip[] = [];
  for (const part of value.split(',')) {
    if (!part.trim()) continue;
    const parsed = parsePortChip(part, chips);
    if (parsed.chip) chips.push(parsed.chip);
  }
  return chips;
}

/** Cảnh báo mềm: dải quá rộng vẫn lưu được (API cũng chỉ cảnh báo), nhưng phải nói ra. */
const WIDE_RANGE_PORTS = 1000;

export function isWideRange(chip: PortChip): boolean {
  return chip.to - chip.from + 1 > WIDE_RANGE_PORTS;
}
