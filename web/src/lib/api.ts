import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';

export const ME_KEY = ['auth', 'me'] as const;

/**
 * Ngưỡng bật lời cảnh báo "sắp mất phiên".
 *
 * KHÔNG cảnh báo ngay từ lần sai đầu: gõ nhầm một lần là chuyện thường ngày, và một dòng
 * "còn 4 lần nữa" lúc đó chỉ làm người ta hoảng — rồi tới lần thật sự sát ngưỡng thì câu
 * cảnh báo đã thành tiếng ồn quen tai. Chỉ nói khi nó còn đổi được hành vi của người đọc.
 */
const WARN_WHEN_ATTEMPTS_LEFT_AT_MOST = 2;

/**
 * Thông điệp lỗi từ API luôn là tiếng Việt (convention Error của spine).
 *
 * ===== THAM SỐ THỨ BA: "CÒN MẤY LẦN" =====
 *
 * Ba cửa của `auth.service` trả kèm `attemptsLeft` khi một lượt sai đưa người dùng tới gần
 * chỗ bị THU HỒI PHIÊN: gõ sai mã lúc đăng nhập, gõ sai mã ở cửa két, và (từ A-02) gõ sai
 * mật khẩu ở cửa cài 2 lớp. Tới 20/09 **không màn nào đọc con số đó** — nên người gõ nhầm
 * thấy "sai mã, sai mã, sai mã, sai mã" rồi đột ngột bị đá ra, không hiểu vì sao.
 *
 * Câu cảnh báo do NƠI GỌI dựng (`t(...)`), không dựng ở đây: `lib/` không kéo i18n vào, và
 * DoD gạch 6 cấm chuỗi tiếng Việt cứng. Nhưng phép QUYẾT ĐỊNH "khi nào thì nói" nằm ở đây,
 * đúng một bản — ba màn hình tự chọn ngưỡng riêng là ba hành vi khác nhau ở ba cửa giống hệt.
 */
export function errorMessage(
  error: unknown,
  fallback = 'Có lỗi xảy ra.',
  nearLimit?: (attemptsLeft: number) => string,
): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: string; attemptsLeft?: number } | null;
    if (body?.message) {
      const left = body.attemptsLeft;
      if (
        nearLimit &&
        typeof left === 'number' &&
        left > 0 &&
        left <= WARN_WHEN_ATTEMPTS_LEFT_AT_MOST
      ) {
        return `${body.message} ${nearLimit(left)}`;
      }
      return body.message;
    }
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
  options: {
    method?: 'POST' | 'PATCH' | 'DELETE';
    csrfToken?: string | null;
    refreshMe?: boolean;
    /**
     * Chọn phần nào của input đi vào body. Cần khi input mang cả tham số ĐƯỜNG DẪN
     * (vd `id`): API bật `forbidNonWhitelisted` nên body thừa field là 400.
     */
    body?: (input: TInput) => unknown;
  } = {},
) {
  const queryClient = useQueryClient();
  const method = options.method ?? 'POST';
  return useMutation<TResult, unknown, TInput>({
    mutationFn: async (input: TInput) => {
      const url = typeof path === 'function' ? path(input) : path;
      const payload = options.body ? options.body(input) : input;
      return apiFetch<TResult>(url, {
        method,
        credentials: 'include',
        csrfToken: options.csrfToken ?? null,
        body: payload === undefined ? undefined : JSON.stringify(payload),
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
