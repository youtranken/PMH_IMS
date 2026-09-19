import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Quét đệ quy một cây nguồn, trả về đường dẫn mọi file khớp đuôi — dùng cho các bài "điểm danh"
 * đọc source dạng văn bản (`dead-keys-rollcall`, `confirm-title-rollcall`, `history-action-rollcall`).
 *
 * ===== VÌ SAO LÀ BẢN DÙNG CHUNG =====
 *
 * Ba bài trên từng có ba bản `walk()` chép tay giống hệt nhau. Ngày 18/09 một trong ba bị đỏ
 * ngẫu nhiên:
 *
 *   ENOENT: no such file or directory, open 'web/src/__lint-probe__E1j2jq/probe.tsx'
 *
 * `lint-rules.test.ts` TẠO RỒI XOÁ thư mục tạm `__lint-probe__*` ngay trong `web/src` để thử
 * xem luật eslint có thật sự bắt hay không; Vitest chạy các file kiểm SONG SONG, nên một bài
 * đang quét cây có thể đọc trúng một thư mục vừa biến mất. Bản `dead-keys-rollcall` được vá
 * hôm đó — hai bản kia thì không, và ngày 19/09 `confirm-title-rollcall` đỏ đúng cách ấy trong
 * một lượt `ci-local.sh`, rồi tự xanh ở lượt sau. Một bài chập chờn không tên là thứ đắt nhất
 * trong bộ kiểm: nó dạy người ta chạy lại thay vì đọc.
 *
 * Vá bản thứ hai rồi chờ bản thứ ba là sai luật AD-15. Một bản, ba nơi gọi.
 *
 * ĐÍNH CHÍNH 19/09 (cùng ngày): bản đầu của file này chỉ được đấu vào HAI nơi —
 * `confirm-title-rollcall` và `history-action-rollcall` — trong khi câu trên đã viết "ba".
 * `dead-keys-rollcall`, chính file được viện dẫn làm dẫn chứng ở trên, vẫn giữ bản `walk()`
 * riêng kèm bản sao của luật bỏ qua `__lint-probe__`. Lượt rà soát cùng ngày đếm ra. Nay đủ ba.
 * Ghi lại vì nó là ví dụ sạch nhất cho thói xấu mà cả đợt này lên án: vá đúng chỗ được chỉ
 * đích danh, không đi tìm ổ còn lại — rồi viết chú thích như thể đã tìm.
 *
 * ===== VÌ SAO BỎ QUA THEO TÊN, KHÔNG PHẢI `try/catch` =====
 *
 * Nuốt ENOENT quanh `readFileSync` là nuốt luôn mọi lỗi đọc THẬT, mà các bài này sống bằng
 * việc đọc được HẾT mọi file nguồn: sót một file là một khoá dịch bị kết luận nhầm là chết,
 * hoặc một `askConfirm` thiếu tiêu đề lọt lưới. Bỏ qua đúng thư mục đã biết là rác thì phạm vi
 * hẹp và nói ra được lý do.
 */
export function quetNguon(goc: string, duoi: RegExp): string[] {
  return readdirSync(goc, { withFileTypes: true }).flatMap((muc) => {
    const day = join(goc, muc.name);
    if (muc.isDirectory()) {
      return muc.name.startsWith('__lint-probe__') ? [] : quetNguon(day, duoi);
    }
    return muc.isFile() && duoi.test(muc.name) ? [day] : [];
  });
}
