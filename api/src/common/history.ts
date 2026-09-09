/**
 * TRẦN CHUNG cho mọi panel "Lịch sử" của một hồ sơ (AD-13, AD-15).
 *
 * ===== VÌ SAO LÀ MỘT HẰNG SỐ, KHÔNG PHẢI MỘT HÀM =====
 *
 * Mười bộ đọc lịch sử trong repo chạy cùng một hình dạng — `select … where <khóa ngoại> …
 * orderBy(desc(createdAt)) … limit(N)` — nhưng phần `where` KHÁC NHAU thật: mỗi bảng một cột
 * khóa ngoại, hai bảng ghép hai cột. Gói cả câu vào một hàm generic sẽ phải đánh vật với kiểu
 * của drizzle và đẻ ra một lớp trừu tượng khó đọc hơn chính câu nó thay thế.
 *
 * Thứ THẬT SỰ trôi khỏi nhau là con số. Đếm ngày 09/09:
 *
 *     approvals · nat-rule · service-account   → KHÔNG CÓ TRẦN NÀO
 *     catalog · expiry                          → 100
 *     devices · ip-address · isp-line · software → 200
 *
 * Ba cái đầu là lỗi thật, không phải chuyện thẩm mỹ: `approval_history` và `nat_rule_history`
 * là bảng CHỈ-THÊM (AD-13) nên chúng chỉ có thể dài ra. Một phiếu duyệt bị nhắc lại nhiều
 * lần, hay một rule NAT sửa đi sửa lại vài năm, sẽ kéo toàn bộ lịch sử về trình duyệt cho một
 * cái panel không ai cuộn hết — và càng dùng lâu càng chậm, đúng lúc lịch sử đáng giá nhất.
 *
 * ===== VÌ SAO 200 =====
 *
 * Đủ để một hồ sơ dùng vài năm vẫn thấy hết phần người ta thực sự đọc, và đủ nhỏ để không
 * bao giờ thành vấn đề. Con số này KHÔNG vào `system_config`: nó không phải luật nghiệp vụ
 * (AD-11) mà là trần kỹ thuật của một cái panel — đổi nó không đổi câu trả lời nào cho người
 * dùng, chỉ đổi số dòng tải về.
 *
 * `history-readers.spec.ts` canh: thêm một bộ đọc lịch sử mà quên trần, hoặc gõ số khác, là
 * test đỏ.
 */
export const HISTORY_PAGE_LIMIT = 200;
