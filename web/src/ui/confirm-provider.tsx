import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmCtx } from '@/ui/confirm-context';
import type { ConfirmFn, ConfirmOptions } from '@/ui/confirm-context';
import { ConfirmDialog } from '@/ui/confirm-dialog';

/*
 * Cái context và `useConfirm` nay ở `ui/confirm-context.ts` — `ui/dialog.tsx` cần chúng cho
 * prop `guardUnsaved`, mà import ngược file này sẽ thành vòng phụ thuộc (depcruise chặn).
 * Re-export để mọi chỗ gọi sẵn có vẫn viết `from '@/ui/confirm-provider'` như cũ.
 */
export { useConfirm } from '@/ui/confirm-context';
export type { ConfirmOptions } from '@/ui/confirm-context';

/**
 * Thay window.confirm bằng ConfirmDialog (Radix) qua một API async dùng chung:
 *   const askConfirm = useConfirm();
 *   if (!(await askConfirm({ message, danger: true }))) return;
 * Một dialog duy nhất ở gốc app — nơi gọi chỉ đổi 1 dòng, không tự quản state/JSX.
 */
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
          typeToConfirm={opts.typeToConfirm}
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
