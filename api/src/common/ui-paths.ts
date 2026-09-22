/**
 * ĐƯỜNG DẪN GIAO DIỆN mà API sinh ra — bản đối chiếu của `web/src/lib/routes.ts`.
 *
 * ===== VÌ SAO FILE NÀY PHẢI TỒN TẠI (B-07, 22/09) =====
 *
 * API sinh link UI ở bảy chỗ: khối "sắp hết hạn", ba panel khu mở rộng của trang thiết bị, và
 * nút CTA trong email duyệt yêu cầu. Cả bảy đều tự gõ chuỗi, và cả bảy đều gõ theo lối
 * TIẾNG VIỆT BẢN CŨ — `/thiet-bi/`, `/phan-mem/`, `/duong-truyen/`, `/dia-chi-ip/`,
 * `/duyet-yeu-cau` — trong khi quyết định 26/08 đã đổi URL sang tiếng Anh và
 * `web/src/lib/routes.ts` tự khai mình là "NGUỒN DUY NHẤT".
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
 * khác hẳn bản sao trôi tự do — và F-09 trong cùng lượt rà soát này là ví dụ sống của bản sao
 * không có cổng: năm bản chép của một hàm, và chúng ĐÃ lệch.
 */

/** Đường dẫn tương đối, KHÔNG kèm host — nơi gọi tự ghép `APP_BASE_URL` nếu cần link tuyệt đối. */
export const UI_PATHS = {
  device: (id: string) => `/devices/${id}`,
  software: (id: string) => `/software/${id}`,
  ispLine: (id: string) => `/isp-lines/${id}`,
  /** Màn dải IP nhận id của DẢI, không phải của địa chỉ — giữ đúng như `routes.ts.subnet`. */
  subnet: (id: string) => `/ip-addresses/${id}`,
  serviceAccount: (id: string) => `/service-accounts/${id}`,
  approvals: '/approvals',
  expiry: '/expiry',
} as const;
