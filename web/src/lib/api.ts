import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';

export const ME_KEY = ['auth', 'me'] as const;

/** Thông điệp lỗi từ API luôn là tiếng Việt (convention Error của spine). */
export function errorMessage(error: unknown, fallback = 'Có lỗi xảy ra.'): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: string } | null;
    if (body?.message) return body.message;
  }
  return fallback;
}

export function errorCode(error: unknown): string | null {
  if (error instanceof ApiError) {
    const body = error.body as { code?: string } | null;
    return body?.code ?? null;
  }
  return null;
}

/**
 * Phiên hiện tại. `retry: false` để màn đăng nhập không phải chờ 2 lần thử khi chưa có phiên.
 * apiFetch KHÔNG tự redirect ở đây (401 là trạng thái hợp lệ: chưa đăng nhập).
 */
export function useMe() {
  return useQuery<Me | null>({
    queryKey: ME_KEY,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      if (res.status === 401) return null;
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      return (await res.json()) as Me;
    },
  });
}

/**
 * Mutation gửi kèm CSRF token của phiên (AD-8) — AD-15: không màn nào tự nhớ đính header.
 * Sau khi thành công, làm mới `me` để UI phản ánh trạng thái mới (đổi mật khẩu, step-up…).
 */
export function useApiMutation<TInput, TResult>(
  path: string | ((input: TInput) => string),
  options: { method?: 'POST' | 'PATCH' | 'DELETE'; csrfToken?: string | null; refreshMe?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const method = options.method ?? 'POST';
  return useMutation<TResult, unknown, TInput>({
    mutationFn: async (input: TInput) => {
      const url = typeof path === 'function' ? path(input) : path;
      return apiFetch<TResult>(url, {
        method,
        credentials: 'include',
        csrfToken: options.csrfToken ?? null,
        body: input === undefined ? undefined : JSON.stringify(input),
      });
    },
    /**
     * PHẢI `await`: nếu chỉ bắn invalidate rồi trả về ngay, callback `onSuccess` của nơi gọi
     * sẽ điều hướng khi `me` CÒN CŨ — RequireAuth đọc `mustChangePassword`/`totpPending` cũ
     * và đá người dùng ngược lại màn vừa hoàn thành (lỗi phát hiện ở E2E story 1.2).
     * Trả promise ở đây khiến react-query chờ xong mới gọi callback của nơi gọi.
     */
    onSuccess: async () => {
      if (options.refreshMe !== false) {
        await queryClient.invalidateQueries({ queryKey: ME_KEY });
      }
    },
  });
}
