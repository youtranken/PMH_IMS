/**
 * Số học IPv4 — hàm THUẦN, không chạm DB (story 5.1, FR-018/FR-020).
 *
 * Tách ra vì đây là chỗ sai thầm lặng nhất của cả epic: sai một bit là cấp trùng IP, và
 * chuyện đó chỉ lộ ra ở ngoài mạng — hai máy cùng IP, người dùng báo "mạng chập chờn", còn
 * hệ thống thì vẫn nói mọi thứ ổn. Kiểm bằng bảng dữ liệu rẻ hơn nhiều so với đi dò cáp.
 *
 * v1 CHỈ IPv4: PMH chạy 172.16.x/24 trên LAN, chưa có IPv6. Nhận IPv6 nửa vời còn tệ hơn
 * từ chối thẳng — người ta khai vào rồi tưởng hệ thống quản được.
 */

/**
 * Trần độ rộng một dải: /24 (254 host). Quyết định của chủ dự án, 25/08/2026.
 *
 * Không phải giới hạn tuỳ tiện: `listBySubnet` liệt kê MỌI host của dải trong một lượt gọi và
 * `enumerateHosts` dựng mảng đồng bộ. Nên gõ nhầm /16 thay /24 là 65.534 dòng (treo tab), /8
 * là 16 triệu (treo luôn server). Chặn ngay lúc khai dải là chỗ rẻ nhất. Mạng lớn hơn thì
 * chia thành nhiều dải /24 — cách PMH vẫn đang đánh số LAN.
 *
 * Trần này CHÍNH LÀ thứ cho phép màn dải cắt trang ở client (50 dòng/trang, `slot-paging.ts`):
 * 254 host về gọn trong một lượt gọi, nên đổi trang là tức thì và con số đếm trên từng nút lọc
 * vẫn tính trên cả dải. Nới trần ở đây thì phải đẩy phân trang xuống server trước.
 */
const MIN_PREFIX = 24;

/**
 * Cột `inet` của Postgres trả về kèm mask (`172.16.10.5/32`); người dùng và mọi ô nhập đều nói
 * địa chỉ trần. Chuẩn hóa về một dạng trước khi SO SÁNH hay HIỂN THỊ.
 *
 * Gom về đây (AD-15) vì tới 08/09 khái niệm này đã có ba bản: một hàm riêng trong
 * `nat-rule.service.ts`, một dòng `split('/')[0]` chép tay trong `ip-address.service.ts`, và
 * hàng rào NAT mới cần bản thứ ba. Ba bản của cùng một phép chuẩn hóa là ba cơ hội để hai
 * cuốn sổ trả lời khác nhau về CÙNG một địa chỉ — đúng loại lệch mà finding #6 nói tới.
 */
export function hostOf(value: string): string {
  return value.split('/')[0];
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Đúng 4 nhóm 0–255, KHÔNG cho số 0 đứng đầu (tránh bị đọc theo hệ 8). */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseAddress(value: string): ParseResult<string> {
  const text = value.trim();
  const match = IPV4.exec(text);
  if (!match) return { ok: false, reason: 'not_ipv4' };
  for (let i = 1; i <= 4; i += 1) {
    const part = match[i];
    if (part.length > 1 && part.startsWith('0')) return { ok: false, reason: 'leading_zero' };
    if (Number(part) > 255) return { ok: false, reason: 'octet_range' };
  }
  return { ok: true, value: text };
}

/**
 * Từ khoá ở ô tìm thiết bị có phải một IP (đủ hoặc thiếu nhóm cuối) không.
 *
 * Đủ 4 nhóm thì so KHỚP ĐÚNG: gõ `10.0.0.5` mà ra cả `.50`–`.59` là trả lời sai câu "máy nào
 * đang giữ IP này". Thiếu nhóm thì hiểu là cả nhóm (`10.77.1` → `10.77.1.*`), không phải "bắt
 * đầu bằng chữ số" — nếu không `10.77.1` sẽ kéo theo cả `10.77.10`–`10.77.199`.
 *
 * Cần ít nhất một dấu chấm: một số trần như `10` là mã hoặc serial, không phải IP.
 */
export function ipSearchPattern(
  term: string,
): { exact: string | null; prefix: string | null } | null {
  const text = term.trim().replace(/\.$/, '');
  const parts = text.split('.');
  if (parts.length < 2 || parts.length > 4) return null;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
  }
  if (parts.length === 4) return { exact: text, prefix: null };
  return { exact: null, prefix: `${text}.` };
}

export function addressToLong(address: string): number {
  const [a, b, c, d] = address.split('.').map(Number);
  // `>>> 0`: dịch bit trong JS làm việc trên số CÓ DẤU 32 bit, nên 255.x.x.x ra số âm.
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

export function longToAddress(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

export interface Subnet {
  /** Dạng chuẩn `<địa chỉ mạng>/<prefix>`. */
  cidr: string;
  network: number;
  prefix: number;
}

/**
 * Chuẩn hóa dải người dùng gõ vào.
 *
 * Quy về ĐỊA CHỈ MẠNG: người ta hay gõ IP máy mình kèm /24 (`172.16.10.37/24`). Lưu nguyên
 * như vậy thì hai người khai cùng một dải ra hai bản ghi khác nhau, và ràng buộc "không
 * trùng dải" mất tác dụng ngay từ đầu.
 */
export function normalizeSubnet(
  value: string,
): { ok: true; cidr: string; network: number; prefix: number } | { ok: false; reason: string } {
  const text = value.trim();
  const slash = text.lastIndexOf('/');
  if (slash < 0) return { ok: false, reason: 'missing_prefix' };

  const address = parseAddress(text.slice(0, slash));
  if (!address.ok) return { ok: false, reason: address.reason };

  const prefixText = text.slice(slash + 1);
  if (!/^\d{1,2}$/.test(prefixText)) return { ok: false, reason: 'bad_prefix' };
  const prefix = Number(prefixText);
  if (prefix > 32) return { ok: false, reason: 'bad_prefix' };
  if (prefix < MIN_PREFIX) return { ok: false, reason: 'too_wide' };

  const network = maskOf(prefix) === 0 ? 0 : (addressToLong(address.value) & maskOf(prefix)) >>> 0;
  return { ok: true, cidr: `${longToAddress(network)}/${prefix}`, network, prefix };
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function isHostInSubnet(address: string, cidr: string): boolean {
  const host = parseAddress(address);
  const subnet = normalizeSubnet(cidr);
  if (!host.ok || !subnet.ok) return false;
  return ((addressToLong(host.value) & maskOf(subnet.prefix)) >>> 0) === subnet.network;
}

/**
 * Số địa chỉ CẤP ĐƯỢC — đã trừ địa chỉ mạng và địa chỉ quảng bá.
 *
 * Hai ngoại lệ có thật, không phải chuyện lý thuyết:
 *  - /31: link point-to-point giữa hai router (RFC 3021), cả hai địa chỉ đều dùng được.
 *  - /32: đúng một máy, không có gì để trừ.
 */
export function usableHostCount(cidr: string): number {
  const subnet = normalizeSubnet(cidr);
  if (!subnet.ok) return 0;
  const size = 2 ** (32 - subnet.prefix);
  if (subnet.prefix >= 31) return size;
  return size - 2;
}

/** Danh sách địa chỉ cấp được, theo thứ tự tăng dần. */
export function enumerateHosts(cidr: string): string[] {
  const subnet = normalizeSubnet(cidr);
  if (!subnet.ok) return [];
  const size = 2 ** (32 - subnet.prefix);
  const first = subnet.prefix >= 31 ? subnet.network : subnet.network + 1;
  const count = subnet.prefix >= 31 ? size : size - 2;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(longToAddress(first + i));
  return out;
}

/** Vai trò của một địa chỉ trong dải của nó. Chỉ `host` mới gán cho máy được. */
export type HostRole = 'host' | 'network' | 'broadcast';

/**
 * Địa chỉ này có gán cho máy được không, khi CHƯA biết dải?
 *
 * Suy từ octet cuối, nên chỉ là phép ĐOÁN: đúng cho /24 (.0 mạng, .255 quảng bá), nhưng bỏ
 * sót .127/.128 của /25, .63/.64… của /26, và chặn nhầm .0/.255 khi chúng là máy trong /31 hay
 * /32. Biết dải chứa địa chỉ thì dùng `hostRoleIn`; bản này chỉ cho IP nằm ngoài mọi dải.
 *
 * Vì sao cần: gán 172.16.0.0 cho một máy là dữ liệu không bao giờ đúng ngoài đời — gói tin
 * gửi tới đó không tới máy nào cả. Bên IPAM đã trừ sẵn hai địa chỉ này khi liệt kê dải, nhưng
 * sổ NAT thì nhận IP gõ tay tự do nên lọt thẳng vào.
 *
 * Trả `null` nếu chuỗi không phải IPv4 — không đoán bừa, để nơi gọi báo đúng lỗi định dạng.
 */
export function hostRole(address: string): HostRole | null {
  const parsed = parseAddress(address);
  if (!parsed.ok) return null;
  const last = Number(parsed.value.split('.')[3]);
  if (last === 0) return 'network';
  if (last === 255) return 'broadcast';
  return 'host';
}

/**
 * Vai trò của một địa chỉ trong MỘT dải cụ thể — chính xác hơn `hostRole` vì biết prefix.
 *
 * Cần bản này khi dải hẹp hơn /24: trong `172.16.10.64/26` thì .64 là địa chỉ mạng và .127 là
 * quảng bá, hai con số mà nhìn octet cuối không thể biết.
 *
 * `null` = địa chỉ không thuộc dải, hoặc một trong hai chuỗi không hợp lệ. Câu hỏi lúc đó
 * không có nghĩa, nên không trả lời còn hơn trả lời bừa.
 */
export function hostRoleIn(address: string, cidr: string): HostRole | null {
  const host = parseAddress(address);
  const subnet = normalizeSubnet(cidr);
  if (!host.ok || !subnet.ok) return null;

  const value = addressToLong(host.value);
  if (((value & maskOf(subnet.prefix)) >>> 0) !== subnet.network) return null;

  // /31 và /32: không có địa chỉ mạng hay quảng bá để mà trừ (RFC 3021) — cùng ngoại lệ
  // mà `usableHostCount` đã chừa.
  if (subnet.prefix >= 31) return 'host';

  const broadcast = (subnet.network + 2 ** (32 - subnet.prefix) - 1) >>> 0;
  if (value === subnet.network) return 'network';
  if (value === broadcast) return 'broadcast';
  return 'host';
}

export interface SubnetUsage {
  total: number;
  used: number;
  free: number;
  percent: number;
}

/**
 * FR-020: mức sử dụng subnet.
 *
 * Kẹp trong 0–100 kể cả khi dữ liệu lệch (đếm nhiều hơn số cấp được — vd subnet bị thu hẹp
 * sau khi đã cấp IP): thanh tiến trình 103% tràn ra ngoài khung và người đọc mất lòng tin
 * vào cả trang, trong khi con số đúng thì chẳng ai đọc được gì thêm.
 */
export function subnetUsage(cidr: string, usedCount: number): SubnetUsage {
  const total = usableHostCount(cidr);
  const free = Math.max(0, total - usedCount);
  const percent = total === 0 ? 0 : Math.min(100, Math.round((usedCount / total) * 100));
  return { total, used: usedCount, free, percent };
}

/**
 * Gom hồ sơ theo ĐỊA CHỈ, và khi một địa chỉ có nhiều hồ sơ thì HÀNG SỐNG THẮNG (F-10).
 *
 * ===== VÌ SAO MỘT ĐỊA CHỈ CÓ NHIỀU HÀNG =====
 *
 * `ip_address_key` là UNIQUE **một phần**: `(subnet_id, address) WHERE voided_at IS NULL`.
 * Một hàng sống cộng N hàng đã ẩn cùng địa chỉ là hợp lệ, và là đường đi bình thường — ẩn
 * nhầm một hồ sơ rồi cấp lại địa chỉ ấy cho máy khác.
 *
 * ===== VÌ SAO `new Map(rows.map(...))` LÀ SAI =====
 *
 * Nó giữ hàng CUỐI, mà "cuối" do Postgres quyết: `ORDER BY address` không định nghĩa thứ tự
 * giữa hai hàng CÙNG địa chỉ. Nên màn hình dán badge "Đã ẩn" lên một địa chỉ đang dùng, bộ
 * đếm "Đang dùng" hụt một, và menu bày nút "Bật lại" cho hàng đang sống → API trả `IP_TAKEN`.
 * Lúc đúng lúc sai, không ai dựng lại được để báo.
 *
 * ===== LUẬT =====
 *
 * Sống thắng ẩn. Giữa hai hàng cùng đã ẩn thì hàng ẩn SAU thắng: nó là chương gần nhất của
 * địa chỉ này, và đó là thứ người mở "Hiện hồ sơ đã ẩn" đang đi tìm.
 *
 * KHÔNG bỏ hẳn hàng đã ẩn: cửa `restore()` cần một đường tới nó, và một hồ sơ ẩn nhầm mà
 * không màn nào hiện ra thì "Bật lại" chỉ là một endpoint không ai gọi được.
 *
 * Hàm THUẦN và tổng quát theo hình dạng hàng — nơi gọi truyền gì vào cũng được, miễn có
 * `address` và `voidedAt`. Viết ở đây thay vì nội tuyến trong service để nó có bài kiểm bảng
 * dữ liệu riêng: thứ tự heap của Postgres không phải hợp đồng, nên luật phải tự đứng được mà
 * không cần một cái DB để hỏi.
 */
export function keepPreferredByAddress<T extends { address: string; voidedAt: Date | null }>(
  rows: T[],
): Map<string, T> {
  const byAddress = new Map<string, T>();
  for (const row of rows) {
    const seen = byAddress.get(row.address);
    if (seen === undefined || beatsForDisplay(row, seen)) byAddress.set(row.address, row);
  }
  return byAddress;
}

/** `challenger` có xứng thay `holder` ở ô địa chỉ không. */
function beatsForDisplay(
  challenger: { voidedAt: Date | null },
  holder: { voidedAt: Date | null },
): boolean {
  if (holder.voidedAt === null) return false;
  if (challenger.voidedAt === null) return true;
  return challenger.voidedAt.getTime() >= holder.voidedAt.getTime();
}
