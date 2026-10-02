import { useCallback } from 'react';
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router-dom';
import { LOGIN_PATH } from '@/lib/me';

export interface UnsavedGuard {
  /** Đang có một lượt rời màn bị giữ lại, chờ người dùng quyết. */
  blocked: boolean;
  /** Đi tiếp tới đúng đích vừa bị giữ (link menu, Ctrl+K, nút lùi). */
  proceed: () => void;
  /** Huỷ lượt rời màn, ở lại với thay đổi đang dở. */
  stay: () => void;
}

/**
 * Còn thay đổi chưa lưu thì giữ MỌI lượt rời màn trong app — link menu, breadcrumb, `navigate()`
 * của Ctrl+K, nút lùi/tiến của trình duyệt — để màn hỏi bằng `ConfirmDialog` của nó; đóng hoặc
 * tải lại tab thì trình duyệt hỏi bằng hộp riêng (`beforeunload`).
 *
 * Cần data router (`createBrowserRouter` ở `App.tsx`): `useBlocker` ném lỗi dưới `BrowserRouter`.
 *
 * Không giữ:
 *   - lượt chỉ đổi query/hash trên cùng đường dẫn (đổi nhóm, đổi tab): màn tự hỏi ở đó, vì nó
 *     biết phải lưu cái gì trước khi đổi;
 *   - đường về màn đăng nhập: đăng xuất / phiên chết đã xảy ra ở phía máy chủ, "Ở lại" lúc đó
 *     chỉ để lại một màn mà lượt lưu nào cũng sẽ 401.
 */
export function useUnsavedGuard(dirty: boolean): UnsavedGuard {
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      currentLocation.pathname !== nextLocation.pathname &&
      nextLocation.pathname !== LOGIN_PATH,
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [dirty],
    ),
  );

  return {
    blocked: blocker.state === 'blocked',
    proceed: () => blocker.proceed?.(),
    stay: () => blocker.reset?.(),
  };
}
