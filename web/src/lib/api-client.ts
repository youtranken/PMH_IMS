import { QueryClient } from '@tanstack/react-query';
import { LOGIN_PATH, ME_KEY, type Me } from '@/lib/me';
import { rememberNextPath, tabOwner } from '@/lib/next-path';

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
 *  - THÔNG TIN nhập sai (sai mật khẩu, sai mã TOTP, tài khoản đang khóa) → hiện lỗi TẠI CHỖ.
 *  - Mọi 401 CÒN LẠI (phiên hết hạn, bị đá, tài khoản khóa, lỗi không rõ, cả trang lỗi HTML
 *    của nginx không có `code`) → coi như phiên chết, đá về màn đăng nhập.
 *
 * Cố ý là DANH SÁCH LOẠI TRỪ chứ không phải danh sách cho phép: quên khai một mã mới thì
 * người dùng bị đưa về đăng nhập (phiền nhưng an toàn và tự thoát được), chứ không kẹt
 * ở màn hỏng với một toast chung chung.
 */
const USER_INPUT_401_CODES = new Set([
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  // Tài khoản bị vô hiệu hoá ở cửa đăng nhập: chưa có phiên nào để "chết". Thiếu dòng này thì
  // màn đăng nhập tự tải lại mà không nói một lời nào.
  'ACCOUNT_DISABLED',
  'TOTP_INVALID',
  'TOTP_REPLAYED',
  'CURRENT_PASSWORD_WRONG',
  // Hết hạn step-up KHÔNG phải phiên chết: phiên vẫn sống, chỉ cần gõ lại mã 6 số. Thiếu
  // dòng này thì bấm Xem một secret sau 10 phút là bị đá thẳng về màn đăng nhập (FR-022).
  'STEPUP_REQUIRED',
  /*
   * Cùng hình dạng với `STEPUP_REQUIRED`, và cùng cái bẫy (A-02, 20/09): phiên VẪN SỐNG, chỉ
   * là cửa cài 2 lớp muốn thấy mật khẩu trước. Thiếu dòng này thì `totp-enroll.tsx` không bao
   * giờ dựng được ô mật khẩu — người dùng bị đá thẳng về màn đăng nhập, đăng nhập lại, và rơi
   * vào đúng màn vừa đá họ ra. Một vòng kín, không lối thoát, không lời giải thích.
   *
   * `SESSION_REVOKED` thì NGƯỢC LẠI — cố ý KHÔNG có ở đây. Sai mật khẩu đủ ngưỡng thì phiên
   * chết thật, và đá về màn đăng nhập là đúng việc phải làm.
   */
  'REAUTH_REQUIRED',
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

  return readResponse<T>(res);
}

/**
 * Đọc một `Response` của API theo luật chung: lỗi → `ApiError`, 401-phiên-chết → về màn đăng
 * nhập, 204 → `undefined`. MỌI đường gọi API (JSON lẫn multipart của `lib/upload.ts`) phải đi
 * qua đây — đường nào tự đọc `res.ok` thì phiên hết hạn ở đó thành một toast chung chung thay
 * vì đưa người dùng về đăng nhập.
 */
export async function readResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errBody: unknown = await res.json().catch(() => null);
    const code = (errBody as { code?: string } | null)?.code;
    if (res.status === 401 && !(code && USER_INPUT_401_CODES.has(code))) {
      // Phiên chết giữa chừng: đăng nhập lại xong phải về đúng trang đang làm dở — nhưng chỉ
      // khi người đăng nhập lại là CHỦ phiên đó (máy dùng chung), nên nhớ kèm email.
      const { pathname, search, hash } = window.location;
      const owner =
        queryClient.getQueryData<Pick<Me, 'email'> | null>(ME_KEY)?.email ?? tabOwner();
      rememberNextPath(`${pathname}${search}${hash}`, owner);
      window.location.href = LOGIN_PATH;
    }
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Factory để app và test dùng client riêng (test tắt retry cho lỗi hiện ngay). */
function makeQueryClient(): QueryClient {
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
