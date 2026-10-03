import { createContext, useContext, type ReactNode } from 'react';
import { Popover } from '@/ui/popover';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { useDisabledReason } from '@/ui/disabled-reason';

/**
 * Việc trên thanh mảnh của màn bản vẽ. Q-23 muốn MỘT thanh mảnh trên trình vẽ; Q-18 chốt cách gọn
 * một dãy nút: việc chính đứng ngoài, mọi việc khác vào menu ⋮. Mỗi phần của màn (duyệt, dây,
 * khung, bản trình bày…) khai việc của nó dưới dạng này, màn chọn việc nào đứng ngoài theo chế độ.
 */
export interface BarAction extends RowAction {
  /** Nút chính (tô màu) khi đứng ngoài thanh — "Duyệt…", "Lưu". */
  primary?: boolean;
  /** Lý do nút tắt: đứng ngoài thì đọc được qua `aria-describedby`, trong menu thì thành dòng mô tả. */
  disabledReason?: string | null;
}

/** Nút ⋮ của thanh — hộp nổi mở từ mục menu neo vào đây (mục menu biến mất khi menu đóng). */
const BarAnchorContext = createContext<HTMLElement | null>(null);
export const BarAnchorProvider = BarAnchorContext.Provider;
export function useBarAnchor(): HTMLElement | null {
  return useContext(BarAnchorContext);
}

/** Hộp nổi mở từ một mục menu ⋮ của thanh: không có nút riêng, neo vào nút ⋮. */
export function BarPopover({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const anchor = useBarAnchor();
  return (
    <Popover label={title} title={title} open={open} onOpenChange={onOpenChange} anchor={anchor}>
      {children}
    </Popover>
  );
}

/** Một việc đứng ngoài thanh, vẽ thành nút. */
export function BarButton({ action }: { action: BarAction }) {
  const reason = useDisabledReason(action.disabledReason);
  const className = action.primary ? 'btn primary' : action.danger ? 'btn danger' : 'btn';
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={action.disabled || Boolean(action.disabledReason)}
        {...reason.buttonProps}
        onClick={action.onSelect}
      >
        {action.label}
      </button>
      {reason.hint}
    </>
  );
}

/** Việc trong menu: lý do tắt thành dòng mô tả của mục (mục menu không có `aria-describedby`). */
export function toMenuItem(action: BarAction): RowAction {
  const { primary: _primary, disabledReason, ...item } = action;
  return disabledReason ? { ...item, disabled: true, hint: disabledReason } : item;
}

/** Menu ⋮ của thanh. Một việc thì vẽ thành nút — menu một mục là thêm một cú bấm mà không giấu được gì. */
export function BarMenu({ label, subject, items }: { label: string; subject: string; items: BarAction[] }) {
  if (items.length === 0) return null;
  if (items.length === 1) return <BarButton action={{ ...items[0], primary: false }} />;
  return <RowActions label={label} subject={subject} items={items.map(toMenuItem)} />;
}
