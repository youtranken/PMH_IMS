/**
 * Cổng nhạy cảm (danh sách từ `nat.sensitive_ports`) mà một rule NAT đang mở, hoặc `null`.
 *
 * Xét CẢ cổng trong: RDP đổi sang cổng ngoài 33890 vẫn là RDP mở ra Internet — đổi số cổng
 * ngoài chỉ giấu nó khỏi người đọc sổ, không giấu khỏi kẻ quét cổng. Cổng ngoài là một dải
 * thì xét mọi cổng trong dải.
 */
export function sensitivePortOf(
  externalPorts: string,
  internalPort: number,
  sensitive: readonly number[],
): number | null {
  if (sensitive.includes(internalPort)) return internalPort;
  const [fromText, toText] = externalPorts.split('-');
  const from = Number(fromText);
  const to = toText === undefined ? from : Number(toText);
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  return sensitive.find((port) => port >= from && port <= to) ?? null;
}
