import { formatMoney } from '@/lib/format';
import type { HistoryEntry } from '@/ui/history-panel';
import type { SoftwareHistoryRow } from './software-types';

/**
 * Đổi `software_history` thô thành dòng người đọc được cho `HistoryPanel` dùng chung.
 * Tách khỏi component để test bằng bảng dữ liệu (không cần render).
 */

const FIELD_LABEL: Record<string, string> = {
  code: 'mã',
  name: 'tên',
  kind: 'loại',
  vendorId: 'nhà cung cấp',
  seatTotal: 'số seat',
  startDate: 'ngày bắt đầu',
  endDate: 'ngày hết hạn',
  note: 'ghi chú',
  status: 'trạng thái',
  licenseModel: 'kỳ hạn',
  // Kỳ hạn/chi phí RIÊNG của một ghế (0027) — `device` là mã máy, đi kèm làm bối cảnh.
  device: 'ghế',
  cost: 'chi phí',
  contract: 'hợp đồng',
  overSeatReason: 'lý do vượt seat',
};

const ACTION_LABEL: Record<string, string> = {
  created: 'Tạo hồ sơ',
  updated: 'Sửa hồ sơ',
  renewed: 'Gia hạn',
  // Ba hành động này vẫn ghi vào lịch sử từ story 3.2 nhưng chưa bao giờ có nhãn — tab
  // Lịch sử hiện thẳng mã thô "license-assigned" cho người dùng đọc.
  'license-assigned': 'Gán license vào máy',
  'license-released': 'Gỡ license khỏi máy',
  'license-terms-updated': 'Sửa ghế license',
};

const KIND_LABEL: Record<string, string> = {
  license: 'License phần mềm',
  ssl: 'Chứng chỉ SSL',
  domain: 'Tên miền',
  maintenance: 'Hợp đồng bảo trì',
  other: 'Khác',
};

const LICENSE_MODEL_LABEL: Record<string, string> = {
  subscription: 'Thuê bao',
  perpetual: 'Vĩnh viễn',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Đang dùng',
  expired_ok: 'Hết hạn, không gia hạn',
  retired: 'Đã bỏ',
};

export function toSoftwareHistory(rows: SoftwareHistoryRow[]): HistoryEntry[] {
  return rows.map((row) => ({
    id: row.id,
    at: row.createdAt,
    actor: row.actor,
    action: ACTION_LABEL[row.action] ?? row.action,
    detail: describe(row.changes),
  }));
}

function describe(
  changes: Record<string, { before: unknown; after: unknown }> | null,
): string | null {
  if (!changes) return null;
  const parts = Object.entries(changes).map(([field, change]) => {
    const label = FIELD_LABEL[field] ?? field;
    // Id danh mục là uuid, hiện ra chỉ tổ rối — nói "đã đổi" là đủ dùng.
    if (field.endsWith('Id')) return `đổi ${label}`;
    // Trường KHÔNG đổi đi kèm để chỉ rõ đang nói về cái nào (vd ghế nào của license 10 chỗ).
    // Vẽ nó thành "PC-01 → PC-01" là bắt người đọc dừng lại tìm xem đã đổi gì.
    if (change.before === change.after) return `${label} ${display(field, change.after)}`;
    return `${label}: ${display(field, change.before)} → ${display(field, change.after)}`;
  });
  return parts.length > 0 ? parts.join('; ') : null;
}

function display(field: string, value: unknown): string {
  // `cost` = 0 là giá trị THẬT (license tặng kèm máy) — không được rơi vào nhánh "(trống)".
  if (field === 'cost' && typeof value === 'number') return formatMoney(value);
  if (value === null || value === undefined || value === '') return '(trống)';
  if (field === 'kind') return KIND_LABEL[String(value)] ?? String(value);
  if (field === 'licenseModel') return LICENSE_MODEL_LABEL[String(value)] ?? String(value);
  if (field === 'status') return STATUS_LABEL[String(value)] ?? String(value);
  return String(value);
}
