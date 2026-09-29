import { diffRecord, type RecordChanges } from '../../common/record-diff';
/**
 * Luật của một dòng sổ NAT (story 5.3, FR-017) — hàm THUẦN, không chạm DB.
 *
 * Mục tiêu của story viết rất rõ: auditor hỏi "port nào mở, vì sao, cho ai" là trả lời được
 * ngay. Nên `reason` và `usedBy` ở đây là BẮT BUỘC, không phải trường tùy chọn cho đẹp — một
 * dòng thiếu lý do là một dòng sáu tháng sau không ai dám đóng vì không biết nó phục vụ ai,
 * và cứ thế port nằm mở mãi.
 */

import { hostRole, hostRoleIn } from './ip-rules';

const MIN_PORT = 1;
const MAX_PORT = 65535;
/** Rộng hơn ngần này thì CẢNH BÁO — không chặn. Xem `NatRuleCheck` bên dưới. */
const WIDE_RANGE = 1000;

export type PortRange =
  | { ok: true; from: number; to: number }
  | { ok: false; reason: 'format' | 'range' | 'reversed' };

/**
 * Nhận "8080" hoặc "8000-8010".
 *
 * Khoảng viết ngược báo RIÊNG (`reversed`) chứ không gộp vào "sai định dạng": người gõ biết
 * mình muốn gì, chỉ đảo hai đầu — nói đúng chỗ sai thì họ sửa trong hai giây, còn nói chung
 * chung thì họ ngồi soi lại cả dòng.
 */
export function parsePortRange(value: string): PortRange {
  const text = value.trim();
  const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(text);
  if (!match) return { ok: false, reason: 'format' };

  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (!inPortRange(from) || !inPortRange(to)) return { ok: false, reason: 'range' };
  if (from > to) return { ok: false, reason: 'reversed' };
  return { ok: true, from, to };
}

export function describePortRange(from: number, to: number): string {
  return from === to ? String(from) : `${from}-${to}`;
}

export interface NatRuleDraft {
  externalFrom: number;
  externalTo: number;
  internalIp: string;
  internalPort: number;
  usedBy: string;
  reason: string;
}

/**
 * Kết quả kiểm một dòng: LỖI thì không lưu được, CẢNH BÁO thì lưu được nhưng phải nói ra.
 *
 * Tách hai loại này là điểm sửa của code review Epic 5 (finding 1). Trước đây cả hai cùng đổ
 * vào một mảng `errors`, nên "mở hơn 1000 cổng" — thứ tôi CỐ Ý muốn cho qua và còn viết hẳn
 * trong thông điệp là *"nếu đúng ý thì cứ lưu"* — lại bị chặn. Người dùng đọc được lời khuyên
 * mà không làm theo được, và dải port camera (50000-52000, đúng ví dụ trong chính comment cũ)
 * không bao giờ vào nổi sổ NAT.
 *
 * Bài học đắt hơn: test cũ chỉ đếm `errors.length === 1` nên nó XANH trong khi hành vi sai.
 * Kiểu dữ liệu tách bạch làm chuyện đó không lặp lại được nữa.
 */
export interface NatRuleCheck {
  errors: string[];
  warnings: string[];
}

/**
 * Trả về danh sách lỗi + cảnh báo (thay vì ném ở lỗi đầu tiên): form NAT có sáu ô, sửa từng
 * lỗi một là sáu lần bấm Lưu.
 */
export function validateNatRule(
  draft: NatRuleDraft,
  /**
   * Dải đã khai chứa `internalIp`, nếu có. Có dải thì xét theo prefix của nó (`hostRoleIn`):
   * octet cuối không nói được .127 là quảng bá của /25, hay .255 là một máy trong /31.
   * `null`/bỏ trống = IP nằm ngoài mọi dải đã khai, chỉ còn cách đoán theo octet cuối.
   */
  subnetCidr?: string | null,
): NatRuleCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!draft.usedBy.trim()) {
    errors.push('Ghi rõ luật NAT này mở cho ai dùng — đó là câu auditor sẽ hỏi.');
  }
  if (!draft.reason.trim()) {
    errors.push('Ghi rõ vì sao phải mở cổng này. Không có lý do thì sau này không ai dám đóng.');
  }
  /**
   * IP trong phải là một MÁY, không phải địa chỉ mạng hay địa chỉ quảng bá.
   *
   * Hai nhánh nối tiếp chứ không song song: chuỗi sai định dạng thì `hostRole` trả `null`, và
   * báo thêm "đây là địa chỉ mạng" lúc đó là báo chồng một điều chưa biết đúng hay sai.
   */
  const role =
    hostRole(draft.internalIp) === null
      ? null
      : subnetCidr
        ? hostRoleIn(draft.internalIp, subnetCidr)
        : hostRole(draft.internalIp);
  if (role === null) {
    errors.push('IP trong phải là địa chỉ IPv4 hợp lệ, vd 172.16.10.5.');
  } else if (role !== 'host') {
    errors.push(
      role === 'network'
        ? `${draft.internalIp} là ĐỊA CHỈ MẠNG của dải, không phải một máy — gói tin chuyển tới đó không tới đâu cả. Nhập IP thật của máy, vd 172.16.10.5.`
        : `${draft.internalIp} là ĐỊA CHỈ QUẢNG BÁ của dải, không phải một máy. Nhập IP thật của máy, vd 172.16.10.5.`,
    );
  }
  if (!inPortRange(draft.internalPort)) {
    errors.push(`Cổng trong phải từ ${MIN_PORT} đến ${MAX_PORT}.`);
  }

  /**
   * Khoảng port ngoài kiểm Ở ĐÂY chứ không chỉ ở bộ phân tích chuỗi của controller.
   *
   * Code review Epic 5 (finding 2): `NatRuleService.create` là một hàm công khai — import
   * Excel về sau, seed, hay module khác gọi lại đều đi thẳng vào đây mà không qua DTO HTTP.
   * Không kiểm thì cặp ngược đầu rơi xuống `nat_external_range_check` của Postgres và bung
   * 500 thay vì một câu tiếng Việt.
   */
  if (!inPortRange(draft.externalFrom) || !inPortRange(draft.externalTo)) {
    errors.push(`Cổng ngoài phải từ ${MIN_PORT} đến ${MAX_PORT}.`);
  } else if (draft.externalFrom > draft.externalTo) {
    errors.push('Khoảng cổng ngoài viết ngược — số đầu phải nhỏ hơn số cuối (vd 8000-8010).');
  } else if (draft.externalTo - draft.externalFrom + 1 > WIDE_RANGE) {
    // CẢNH BÁO, không phải lỗi: dải port camera là việc có thật và hợp lệ.
    warnings.push(
      `Dải cổng ngoài này mở hơn ${WIDE_RANGE} cổng ra Internet. Nếu đúng ý thì cứ lưu, nhưng hãy chắc chắn.`,
    );
  }

  return { errors, warnings };
}

function inPortRange(port: number): boolean {
  return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
}

/**
 * Hai rule có đụng nhau về giao thức không?
 *
 * `tcp` và `udp` KHÔNG đụng nhau — Draytek cho khai riêng hai giao thức cùng port, chặn là
 * chặn nhầm việc hợp lệ. Nhưng `both` thì theo định nghĩa PHỦ CẢ HAI, nên nó đụng với mọi
 * thứ. Ràng buộc `EXCLUDE` của DB so `protocol WITH =` nên không thấy chuyện này (code review
 * Epic 5, finding 4) — service phải tự bắt.
 */
export function protocolsOverlap(a: string, b: string): boolean {
  return a === b || a === 'both' || b === 'both';
}

/** Hai khoảng port có giao nhau không (biên tính vào). */
export function rangesOverlap(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

/** Bộ ô của một rule NAT được theo dõi trong lịch sử (AD-13). */
export interface NatRuleSnapshot {
  ports: string;
  protocol: string;
  internalIp: string;
  internalPort: number;
  usedBy: string;
  reason: string;
  enabled: boolean;
  note: string | null;
}

const NAT_TRACKED = [
  'ports',
  'protocol',
  'internalIp',
  'internalPort',
  'usedBy',
  'reason',
  'enabled',
  'note',
] as const;

/**
 * Ô nào của rule NAT thật sự đổi sau một lượt sửa — hàm THUẦN.
 *
 * Gộp `externalFrom`/`externalTo` thành MỘT ô `ports` ("8000-8010") vì người đọc lịch sử nghĩ
 * theo khoảng port, không theo hai con số rời: "8000→8000, 8010→8020" bắt họ tự ghép lại trong
 * đầu mới hiểu là dải vừa nới ra.
 *
 * Dùng lại `diffRecord` dùng chung nên luật "rỗng kiểu nào cũng là rỗng" giống hệt mọi bảng
 * khác — bấm vào ô ghi chú rồi bấm ra không đẻ ra dòng lịch sử.
 */
export function natChanges(before: NatRuleSnapshot, after: NatRuleSnapshot): RecordChanges {
  // `{ ...x }` để TS coi nó là `Record<string, unknown>`: interface không có index signature,
  // và nới `diffRecord` ra nhận interface bất kỳ thì mất luôn chỗ chặn gõ nhầm tên trường.
  return diffRecord(NAT_TRACKED, { ...before }, { ...after });
}
