import { QueryClient } from '@tanstack/react-query';

/** Lỗi HTTP mang theo status + body để nơi gọi đọc `code`/`message` tiếng Việt của API. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * 401 có HAI nghĩa khác nhau và không được xử lý giống nhau:
 *  - PHIÊN hỏng (hết hạn, bị SA đá, tài khoản khóa) → đá về màn đăng nhập.
 *  - THÔNG TIN nhập sai (sai mật khẩu, sai mã TOTP) → hiện lỗi TẠI CHỖ cho người dùng sửa.
 * Phân biệt bằng `code` do API trả (convention Error của spine), không đoán theo URL.
 */
const SESSION_DEAD_CODES = new Set([
  'SESSION_MISSING',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'SESSION_INVALID',
  'ACCOUNT_DISABLED',
]);

/**
 * Client fetch dùng chung (AD-15): tự set JSON header + X-CSRF-Token, ném ApiError kèm status,
 * và xử lý 401-phiên-chết tập trung — không màn nào tự viết `window.location.href = '/'`.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { csrfToken?: string | null } = {},
): Promise<T> {
  const { csrfToken, headers, body, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    body,
    credentials: rest.credentials ?? 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    const errBody: unknown = await res.json().catch(() => null);
    const code = (errBody as { code?: string } | null)?.code;
    if (res.status === 401 && code && SESSION_DEAD_CODES.has(code)) {
      window.location.href = '/dang-nhap';
    }
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Factory để app và test dùng client riêng (test tắt retry cho lỗi hiện ngay). */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 10_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export const queryClient = makeQueryClient();
