import { createContext, useContext } from 'react';

/**
 * CHỈ là cái context + kiểu của `useConfirm` — phần dựng hộp nằm ở `ui/confirm-provider.tsx`.
 *
 * ===== VÌ SAO TÁCH RA MỘT FILE =====
 *
 * `ui/dialog.tsx` cần hỏi lại người dùng trước khi vứt dữ liệu chưa lưu (prop `guardUnsaved`).
 * Nhưng `confirm-provider` → `confirm-dialog` → `dialog`, nên `dialog` import ngược lại
 * `confirm-provider` là một VÒNG phụ thuộc, và `web/.dependency-cruiser.cjs` chặn thẳng
 * (`no-circular`, severity error).
 *
 * Tách cái context ra thì chiều phụ thuộc lại đi một hướng:
 *
 *   dialog ──────────────► confirm-context
 *   confirm-provider ────► confirm-context
 *   confirm-provider ────► confirm-dialog ──► dialog
 *
 * `confirm-provider` vẫn re-export `useConfirm` và các kiểu, nên hơn 30 chỗ gọi sẵn có không
 * phải sửa một dòng nào — và cũng không sinh ra hai đường import cho cùng một thứ ở tầng
 * features (chúng cứ dùng `@/ui/confirm-provider` như cũ).
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
  /**
   * Gõ lại đúng `expected` thì nút xác nhận mới bật — cho việc KHÔNG hoàn tác được (xoá vĩnh
   * viễn một ngăn két). Một cú bấm nhầm trên menu ⋯ không được đủ để mất một mật khẩu.
   */
  typeToConfirm?: { expected: string; label: string };
};

/** Kết quả khi có `checkbox`: bấm gì, và ô tick ở trạng thái nào lúc bấm. */
export type ConfirmResult = { ok: boolean; checked: boolean };

export type ConfirmFn = {
  (o: ConfirmOptions & { checkbox: NonNullable<ConfirmOptions['checkbox']> }): Promise<ConfirmResult>;
  (o: ConfirmOptions): Promise<boolean>;
};

/*
 * Mặc định trả `false`: không có provider thì KHÔNG có ai trả lời, và "coi như người dùng bấm
 * Hủy" là phía an toàn — thao tác phá không chạy, thay vì chạy trong im lặng.
 */
export const ConfirmCtx = createContext<ConfirmFn>(
  (() => Promise.resolve(false)) as unknown as ConfirmFn,
);

export function useConfirm() {
  return useContext(ConfirmCtx);
}
