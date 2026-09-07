import { ConflictException } from '@nestjs/common';

/**
 * Chốt của mẫu **compare-and-swap** (AD-5) — dùng chung cho mọi đường ghi có tranh chấp.
 *
 * VẤN ĐỀ NÓ GIẢI QUYẾT (mẫu "M2" của rà soát 28/08, tìm ra ở 6 chỗ độc lập):
 *
 *     const before = await this.db.select(...)      // đọc NGOÀI transaction
 *     if (!hopLe(before.status)) throw ...          // quyết định trên ảnh chụp cũ
 *     await this.db.transaction(async (tx) => {
 *       await tx.update(t).set({...}).where(eq(t.id, id))   // ghi VÔ ĐIỀU KIỆN
 *     })
 *
 * Giữa câu đọc và câu ghi có một khe hở. Người khác kịp đổi trạng thái trong khe đó, nhưng
 * câu UPDATE không hề biết — nó cứ ghi đè. Cả hai người đều thấy "thành công", bảng lịch sử
 * có hai dòng mâu thuẫn, và người bấm trước không bao giờ biết quyết định của mình đã mất.
 *
 * CÁCH DÙNG — mang điều kiện đã kiểm vào CHÍNH câu UPDATE, rồi hỏi nó có trúng gì không:
 *
 *     const rows = await tx.update(t)
 *       .set({ status: to })
 *       .where(and(eq(t.id, id), eq(t.status, from)))   // ← điều kiện đi cùng câu ghi
 *       .returning();
 *     const updated = requireCas(rows, {
 *       code: 'IP_ALREADY_CHANGED',
 *       message: 'Địa chỉ này vừa được người khác đổi. Tải lại để xem trạng thái mới.',
 *     });
 *
 * Bản mẫu gốc: `approvals.service.ts` (Epic 5) — hàm này chỉ rút phần lặp lại ra một chỗ để
 * năm đường ghi còn lại không phải nhớ tự viết `if (rows.length === 0)`.
 *
 * @param rows kết quả `.returning()` của câu UPDATE có điều kiện.
 * @param conflict mã + thông điệp trả cho người dùng khi có người chen ngang. Thông điệp
 *   phải nói được PHẢI LÀM GÌ TIẾP (thường là "tải lại"), không chỉ nói "xung đột".
 * @returns hàng vừa ghi.
 * @throws ConflictException khi không trúng hàng nào — có người chen ngang (lỗi 409, lỗi
 *   của tình huống chứ không phải của người dùng).
 * @throws Error khi trúng nhiều hơn một hàng — câu WHERE thiếu điều kiện khóa chính. Đây là
 *   lỗi lập trình, phải nổ thành 500 chứ không được im lặng lấy hàng đầu: lấy đại hàng đầu
 *   sẽ che mất chuyện vừa ghi đè hàng loạt bản ghi của người khác.
 */
export function requireCas<T>(rows: readonly T[], conflict: { code: string; message: string }): T {
  if (rows.length === 0) throw new ConflictException(conflict);
  if (rows.length > 1) {
    throw new Error(
      `requireCas: câu UPDATE trúng nhiều hơn một hàng (${rows.length}) — WHERE thiếu điều kiện ` +
        `khóa chính. Mã dự kiến: ${conflict.code}.`,
    );
  }
  return rows[0];
}
