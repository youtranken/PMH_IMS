import { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoTip } from '@/ui/info-tip';
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
  /** Một dòng "việc này để làm gì": đứng ngoài thì thành nút (i), trong menu thì thành dòng mô tả. Thiếu → tra `diagrams.help.<key>`. */
  help?: string;
}

type Translate = (key: string) => string;

/**
 * Câu giải thích sẵn có theo `key` của việc (Q-23: màn sơ đồ dùng được ngay không cần học) — mọi
 * phần của màn (duyệt, dây, khung…) có giải thích mà không phải tự truyền chữ. Khoá i18n viết đủ
 * (không dựng bằng template) để bài điểm danh khoá chết thấy nơi dùng.
 */
const HELP: Record<string, string> = {
  publish: 'diagrams.help.publish',
  submit: 'diagrams.help.submit',
  decide: 'diagrams.help.decide',
  withdraw: 'diagrams.help.withdraw',
  pins: 'diagrams.help.pins',
  'pin-mode': 'diagrams.help.pin-mode',
  path: 'diagrams.help.path',
  drift: 'diagrams.help.drift',
  export: 'diagrams.help.export',
  timeline: 'diagrams.help.timeline',
  versions: 'diagrams.help.versions',
  presentation: 'diagrams.help.presentation',
  'rebuild-rack': 'diagrams.help.rebuild-rack',
  draft: 'diagrams.help.draft',
  cabinet: 'diagrams.help.cabinet',
  bind: 'diagrams.help.bind',
  declare: 'diagrams.help.declare',
  bulk: 'diagrams.help.bulk',
  undeclared: 'diagrams.help.undeclared',
  legend: 'diagrams.help.legend',
  photos: 'diagrams.help.photos',
  planned: 'diagrams.help.planned',
  image: 'diagrams.help.image',
  guide: 'diagrams.help.guide',
};

/**
 * Nhóm của việc trong menu ⋮ (Q-23 05/10): menu của màn sửa dài tới mức phải cuộn mới thấy
 * "Hướng dẫn", và một dãy mục phẳng không nói mục nào thuộc việc gì. Khoá i18n viết đủ.
 */
const GROUP: Record<string, string> = {
  guide: 'diagrams.menuGroup.help',
  declare: 'diagrams.menuGroup.cables',
  bulk: 'diagrams.menuGroup.cables',
  undeclared: 'diagrams.menuGroup.cables',
  legend: 'diagrams.menuGroup.cables',
  draft: 'diagrams.menuGroup.cables',
  path: 'diagrams.menuGroup.view',
  drift: 'diagrams.menuGroup.view',
  export: 'diagrams.menuGroup.view',
  cabinet: 'diagrams.menuGroup.frames',
  bind: 'diagrams.menuGroup.frames',
  photos: 'diagrams.menuGroup.frames',
  'rebuild-rack': 'diagrams.menuGroup.frames',
  planned: 'diagrams.menuGroup.frames',
  image: 'diagrams.menuGroup.frames',
  publish: 'diagrams.menuGroup.review',
  submit: 'diagrams.menuGroup.review',
  decide: 'diagrams.menuGroup.review',
  withdraw: 'diagrams.menuGroup.review',
  pins: 'diagrams.menuGroup.review',
  'pin-mode': 'diagrams.menuGroup.review',
  versions: 'diagrams.menuGroup.review',
  timeline: 'diagrams.menuGroup.review',
  presentation: 'diagrams.menuGroup.review',
};

/**
 * Menu ⋮ của thanh cao theo nội dung tới 70% chiều cao màn (V-07): mục nằm dưới một vùng cuộn
 * không dấu hiệu thì coi như không có. `useAnchoredMenu` vẫn chặn theo chỗ trống thật.
 */
const BAR_MENU_SHARE = 0.7;
const BAR_MENU_MIN_PX = 320;
const barMenuMaxPx = () => Math.max(BAR_MENU_MIN_PX, Math.round((typeof window === 'undefined' ? 0 : window.innerHeight) * BAR_MENU_SHARE));

export function actionHelp(t: Translate, action: BarAction): string | undefined {
  const key = HELP[action.key];
  return action.help ?? (key ? t(key) : undefined);
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
  const { t } = useTranslation();
  const reason = useDisabledReason(action.disabledReason);
  const help = actionHelp(t, action);
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
      {help ? <InfoTip subject={action.label}>{help}</InfoTip> : null}
    </>
  );
}

/**
 * Việc trong menu: lý do tắt (nếu có) thắng câu giải thích ở dòng mô tả của mục — mục menu không có
 * `aria-describedby`, và người dùng cần biết vì sao không bấm được hơn là việc đó để làm gì.
 */
export function toMenuItem(action: BarAction): RowAction {
  const { primary: _primary, disabledReason, help, ...item } = action;
  if (disabledReason) return { ...item, disabled: true, hint: disabledReason };
  return help ? { ...item, hint: help } : item;
}

/** Menu ⋮ của thanh. Một việc thì vẽ thành nút — menu một mục là thêm một cú bấm mà không giấu được gì. */
export function BarMenu({ label, subject, items }: { label: string; subject: string; items: BarAction[] }) {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  if (items.length === 1) return <BarButton action={{ ...items[0], primary: false }} />;
  return (
    <RowActions
      label={label}
      subject={subject}
      maxHeight={barMenuMaxPx()}
      items={items.map((item) => ({
        ...toMenuItem({ ...item, help: actionHelp(t, item) }),
        group: t(GROUP[item.key] ?? 'diagrams.menuGroup.other'),
      }))}
    />
  );
}
