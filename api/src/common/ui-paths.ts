/**
 * ĐƯỜNG DẪN GIAO DIỆN mà API sinh ra — bản đối chiếu của `web/src/lib/routes.ts`.
 *
 * ===== VÌ SAO FILE NÀY PHẢI TỒN TẠI (B-07) =====
 *
 * API sinh link UI ở bảy chỗ: khối "sắp hết hạn", ba panel khu mở rộng của trang thiết bị, và
 * nút CTA trong email duyệt yêu cầu. Tự gõ chuỗi ở từng chỗ thì chúng trôi theo lối TIẾNG
 * VIỆT CŨ — `/thiet-bi/`, `/phan-mem/`, `/duong-truyen/`, `/dia-chi-ip/`, `/duyet-yeu-cau` —
 * trong khi URL của web là tiếng Anh và `web/src/lib/routes.ts` là "NGUỒN DUY NHẤT".
 *
 * Nghĩa là bảy cái link chết. Không lỗi nào báo: React Router trả màn 404 rất bình thản, và
 * chẳng ai bấm thử link trong một email test.
 *
 * Chỗ đau nhất là `/duyet-yeu-cau` — nó nằm trong EMAIL GỬI RA NGOÀI. Người duyệt nhận thư
 * "có yêu cầu mở két đang chờ", bấm vào, rơi vào 404, rồi tự đi tìm màn Duyệt bằng tay. Lần
 * sau họ thôi bấm.
 *
 * ===== VÌ SAO CHÉP CHỨ KHÔNG IMPORT =====
 *
 * `api` và `web` là hai gói npm rời, hai `tsconfig`, hai lượt build docker. Không có đường
 * import qua lại, và dựng một gói chung chỉ để chia sáu chuỗi là cái giá lớn hơn thứ nó mua.
 *
 * Nên chép — NHƯNG chép có người canh: `ui-paths.spec.ts` đọc THẲNG `web/src/lib/routes.ts`
 * và so từng đường. Hai bản lệch nhau là bài kiểm đỏ, kèm tên đường nào lệch. Bản sao có cổng
 * khác hẳn bản sao trôi tự do: năm bản chép không cổng của một hàm là năm bản ĐÃ lệch.
 */

/** Đường dẫn tương đối, KHÔNG kèm host — nơi gọi tự ghép `APP_BASE_URL` nếu cần link tuyệt đối. */
export const UI_PATHS = {
  device: (id: string) => `/devices/${id}`,
  software: (id: string) => `/software/${id}`,
  ispLine: (id: string) => `/isp-lines/${id}`,
  /** Màn dải IP nhận id của DẢI, không phải của địa chỉ — giữ đúng như `routes.ts.subnet`. */
  subnet: (id: string) => `/ip-addresses/${id}`,
  /** Mở dải ở ĐÚNG một địa chỉ (tô sáng dòng) — khớp `routes.ts.subnetAt`. */
  subnetAt: (id: string, ip: string) => `/ip-addresses/${id}?ip=${encodeURIComponent(ip)}`,
  /** Sổ NAT lọc sẵn theo router — khớp `routes.ts.natOf`. */
  natOf: (deviceId: string) => `/nat?deviceId=${encodeURIComponent(deviceId)}`,
  serviceAccount: (id: string) => `/service-accounts/${id}`,
  approvals: '/approvals',
  /**
   * Trang chi tiết MỘT yêu cầu — người duyệt quyết ngay tại đó trên điện thoại, không phải tìm
   * thẻ trong danh sách. Vẫn phải đăng nhập + TOTP (Q-05).
   */
  approval: (id: string) => `/approvals/${encodeURIComponent(id)}`,
  expiry: '/expiry',
  /**
   * Màn Nhật ký, lọc sẵn theo người thao tác. `q` là khoá ô tìm của `useListUrlState` bên web
   * — màn Nhật ký đặt ô tìm đó làm bộ lọc người thao tác; `audit-log-screen.test.tsx` canh
   * rằng `?q=` thật sự thành `actor=` khi gọi API.
   */
  auditLog: (actor: string) => `/admin/audit-log?q=${encodeURIComponent(actor)}`,
  /* Màn Tài khoản lọc theo `q` — email là thứ duy nhất vừa tìm được vừa không đổi. */
  account: (email: string) => `/admin/accounts?q=${encodeURIComponent(email)}`,
} as const;
