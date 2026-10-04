import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Chevron } from '@/ui/chevron';
import { PRESENTATIONS_NODE, type BoardRow } from './diagram-board';

/**
 * Cây bên trái của màn bản vẽ (Q-23) theo mẫu cây WAI-ARIA: một điểm dừng Tab (roving tabindex),
 * ↑↓ đi, → mở / xuống con, ← thu / lên cha, Home/End, Enter/Space chọn. Chọn = đổi `?node=`
 * (nơi gọi), nên mở lại link vẫn đúng nút. Dòng phẳng mang `aria-level` thay vì `<ul>` lồng:
 * cây thu/mở chỉ là lọc danh sách, không dựng lại cây DOM.
 */
export function DiagramBoardTree({
  rows,
  selected,
  presentationCount,
  onSelect,
  onToggle,
}: {
  rows: BoardRow[];
  selected: string | null;
  presentationCount: number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [focused, setFocused] = useState<string | null>(selected);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const current = rows.some((r) => r.id === focused) ? focused : (selected ?? rows[0]?.id ?? null);
  const moved = useRef(false);

  useEffect(() => {
    if (!moved.current || !current) return;
    moved.current = false;
    refs.current.get(current)?.focus();
  }, [current]);

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    moved.current = true;
    setFocused(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, row: BoardRow, index: number) => {
    const handled = (() => {
      switch (event.key) {
        case 'ArrowDown':
          focusRow(rows[index + 1]?.id);
          return true;
        case 'ArrowUp':
          focusRow(rows[index - 1]?.id);
          return true;
        case 'Home':
          focusRow(rows[0]?.id);
          return true;
        case 'End':
          focusRow(rows.at(-1)?.id);
          return true;
        case 'ArrowRight':
          if (row.hasChildren && !row.expanded) onToggle(row.id);
          else if (row.hasChildren) focusRow(rows[index + 1]?.id);
          return true;
        case 'ArrowLeft':
          if (row.hasChildren && row.expanded) onToggle(row.id);
          else focusRow(row.parentId ?? undefined);
          return true;
        case 'Enter':
        case ' ':
          onSelect(row.id);
          return true;
        default:
          return false;
      }
    })();
    if (handled) event.preventDefault();
  };

  return (
    <ul role="tree" aria-label={t('diagrams.treeLabel')} className="tree-list board-tree">
      {rows.map((row, index) => {
        const name = row.node ? row.node.name : t('diagrams.board.presentationsGroup', { count: presentationCount });
        return (
          <li
            key={row.id}
            ref={(el) => {
              if (el) refs.current.set(row.id, el);
              else refs.current.delete(row.id);
            }}
            role="treeitem"
            aria-level={row.depth + 1}
            aria-selected={selected === row.id}
            aria-expanded={row.hasChildren ? row.expanded : undefined}
            tabIndex={current === row.id ? 0 : -1}
            className="tree-row"
            data-group={row.id === PRESENTATIONS_NODE ? 'presentations' : undefined}
            style={{ '--depth': row.depth } as CSSProperties}
            onClick={() => {
              setFocused(row.id);
              onSelect(row.id);
            }}
            onKeyDown={(event) => onKeyDown(event, row, index)}
          >
            {/* Bàn phím dùng ←/→; chevron chỉ cho chuột, nên không phải một nút lồng trong treeitem. */}
            <span
              className="tree-toggle"
              aria-hidden="true"
              onClick={(event) => {
                if (!row.hasChildren) return;
                event.stopPropagation();
                onToggle(row.id);
              }}
            >
              {row.hasChildren ? <Chevron direction={row.expanded ? 'down' : 'right'} /> : null}
            </span>
            <span className="tree-name">{name}</span>
          </li>
        );
      })}
    </ul>
  );
}
