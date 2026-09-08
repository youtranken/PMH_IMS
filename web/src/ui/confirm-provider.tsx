import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/ui/confirm-dialog';

/**
 * Thay window.confirm bằng ConfirmDialog (Radix) qua một API async dùng chung:
 *   const askConfirm = useConfirm();
 *   if (!(await askConfirm({ message, danger: true }))) return;
 * Một dialog duy nhất ở gốc app — nơi gọi chỉ đổi 1 dòng, không tự quản state/JSX.
 */
export type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /**
   * Một lựa chọn phụ hiện kèm câu hỏi — vd "Dọn hết thứ liên quan" khi thanh lý thiết bị.
   * Khai `checkbox` thì kết quả trả về là object; không khai thì vẫn là boolean như cũ, nên
   * hơn 30 chỗ gọi sẵn có không phải sửa một dòng nào.
   */
  checkbox?: { label: string; hint?: string; defaultChecked?: boolean };
};

/** Kết quả khi có `checkbox`: bấm gì, và ô tick ở trạng thái nào lúc bấm. */
export type ConfirmResult = { ok: boolean; checked: boolean };

type ConfirmFn = {
  (o: ConfirmOptions & { checkbox: NonNullable<ConfirmOptions['checkbox']> }): Promise<ConfirmResult>;
  (o: ConfirmOptions): Promise<boolean>;
};

const ConfirmCtx = createContext<ConfirmFn>(
  (() => Promise.resolve(false)) as unknown as ConfirmFn,
);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [checked, setChecked] = useState(false);
  const resolver = useRef<((v: never) => void) | null>(null);
  // Ô tick đọc ở `settle` phải là giá trị MỚI NHẤT, không phải bản trong closure lúc mở hộp.
  const checkedRef = useRef(false);

  const askConfirm = useCallback(((o: ConfirmOptions) => {
    // Nếu còn hộp cũ chưa trả lời (gọi confirm chồng nhau) → settle(false) trước,
    // nếu không resolver cũ bị ghi đè và Promise cũ treo vĩnh viễn (caller kẹt await).
    resolver.current?.(false as never);
    const initial = o.checkbox?.defaultChecked ?? false;
    checkedRef.current = initial;
    setChecked(initial);
    setOpts(o);
    return new Promise((resolve) => {
      resolver.current = resolve as (v: never) => void;
    });
  }) as ConfirmFn, []);

  const settle = (result: boolean) => {
    const answer = opts?.checkbox
      ? ({ ok: result, checked: checkedRef.current } as const)
      : result;
    resolver.current?.(answer as never);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmCtx.Provider value={askConfirm}>
      {children}
      {opts && (
        <ConfirmDialog
          title={opts.title ?? t('app.confirmTitle')}
          message={opts.message}
          confirmLabel={opts.confirmLabel ?? t('app.confirmOk')}
          cancelLabel={opts.cancelLabel}
          danger={opts.danger}
          checkbox={opts.checkbox}
          checked={checked}
          onCheckedChange={(next) => {
            checkedRef.current = next;
            setChecked(next);
          }}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmCtx);
}
