/**
 * Lịch sử phần mềm lưu `deviceId` (uuid) cho các dòng gán/gỡ ghế — mã máy có thể đổi, id thì
 * không. Lúc ĐỌC mới tra ra mã máy (qua `DevicesApiService`, AD-2) để tab Lịch sử nói "Gán vào
 * LT-05" thay vì "đổi deviceId".
 */

type Changes = Record<string, unknown> | null;
type Change = { before?: unknown; after?: unknown } | undefined;

export function deviceIdsInHistory(rows: { changes: Changes }[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const change = row.changes?.deviceId as Change;
    if (!change) continue;
    for (const value of [change.before, change.after]) {
      if (typeof value === 'string' && value) ids.add(value);
    }
  }
  return [...ids];
}

export function withDeviceCodes<T extends { changes: Changes }>(
  rows: T[],
  codes: Map<string, string>,
): T[] {
  const code = (value: unknown) =>
    typeof value === 'string' && value ? (codes.get(value) ?? value) : null;
  return rows.map((row) => {
    const change = row.changes?.deviceId as Change;
    if (!row.changes || !change) return row;
    const rest = { ...row.changes };
    delete rest.deviceId;
    return {
      ...row,
      changes: { device: { before: code(change.before), after: code(change.after) }, ...rest },
    };
  });
}
