import { useTranslation } from 'react-i18next';
import type { ViewerCell } from '@/ui/diagram-viewer';
import { Dialog } from '@/ui/dialog';
import type { Finding } from './diagram-api';
import { FindingList } from './diagram-review';

/**
 * Dấu lệch kho lên ô của trình xem (Q-23): ô có lời báo mang dấu (đỏ nếu có lời đỏ, không thì giữ
 * dấu sẵn có hoặc vàng) và tên trợ năng kèm cái đã đổi. Ô lệch mà màn chưa khai bấm được (khung
 * tủ có máy mới) thành ô bấm được để "bay tới" có chỗ đáp và người xem đọc được lời báo.
 */
export function withDriftMarks(cells: ViewerCell[], drift: Finding[]): ViewerCell[] {
  const byCell = new Map<string, Finding[]>();
  for (const finding of drift) {
    if (!finding.cellId) continue;
    byCell.set(finding.cellId, [...(byCell.get(finding.cellId) ?? []), finding]);
  }
  if (byCell.size === 0) return cells;
  const markOf = (found: Finding[], current?: ViewerCell['mark']): ViewerCell['mark'] =>
    found.some((f) => f.level === 'error') ? 'danger' : (current ?? 'warn');
  const out = cells.map((cell) => {
    const found = byCell.get(cell.id);
    if (!found) return cell;
    byCell.delete(cell.id);
    return { ...cell, label: `${cell.label} — ${found.map((f) => f.message).join('; ')}`, mark: markOf(found, cell.mark) };
  });
  for (const [id, found] of byCell) out.push({ id, label: found.map((f) => f.message).join('; '), mark: markOf(found) });
  return out;
}

/** Hộp "Kiểm tra khớp dữ liệu": liệt kê, bấm mục bay tới ô. Không có nút nào sửa gì (không ép). */
export function DriftCheckDialog({ drift, onGoTo, onClose }: { drift: Finding[]; onGoTo: (cellId: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const goTo = (cellId: string) => {
    onClose();
    onGoTo(cellId);
  };
  return (
    <Dialog open onOpenChange={onClose} maxWidth={620} initialFocus="title" title={t('diagrams.drift.title')}>
      <p className="muted">{t('diagrams.drift.hint')}</p>
      {drift.length === 0 ? <p>{t('diagrams.drift.none')}</p> : null}
      <FindingList title={t('diagrams.drift.errors')} items={drift.filter((f) => f.level === 'error')} onGoTo={goTo} />
      <FindingList title={t('diagrams.drift.warnings')} items={drift.filter((f) => f.level === 'warning')} onGoTo={goTo} />
    </Dialog>
  );
}
