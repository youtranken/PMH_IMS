import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Quét đệ quy một cây nguồn, trả về đường dẫn mọi file khớp đuôi — dùng cho các bài "điểm danh"
 * đọc source dạng văn bản (`dead-keys-rollcall`, `confirm-title-rollcall`, `history-action-rollcall`).
 *
 * ===== VÌ SAO LÀ BẢN DÙNG CHUNG =====
 *
 * Ba bản `walk()` chép tay thì mỗi bản phải tự nhớ luật bỏ qua dưới đây, và bản nào quên sẽ
 * đỏ ngẫu nhiên:
 *
 *   ENOENT: no such file or directory, open 'web/src/__lint-probe__E1j2jq/probe.tsx'
 *
 * `lint-rules.test.ts` TẠO RỒI XOÁ thư mục tạm `__lint-probe__*` ngay trong `web/src` để thử
 * xem luật eslint có thật sự bắt hay không; Vitest chạy các file kiểm SONG SONG, nên một bài
 * đang quét cây có thể đọc trúng một thư mục vừa biến mất. Bài như thế đỏ trong một lượt
 * `ci-local.sh` rồi tự xanh ở lượt sau. Một bài chập chờn không tên là thứ đắt nhất trong bộ
 * kiểm: nó dạy người ta chạy lại thay vì đọc.
 *
 * Vá từng bản một là sai luật AD-15. Một bản, ba nơi gọi — bài quét cây mới thì gọi hàm này,
 * đừng chép `walk()` riêng.
 *
 * ===== VÌ SAO BỎ QUA THEO TÊN, KHÔNG PHẢI `try/catch` =====
 *
 * Nuốt ENOENT quanh `readFileSync` là nuốt luôn mọi lỗi đọc THẬT, mà các bài này sống bằng
 * việc đọc được HẾT mọi file nguồn: sót một file là một khoá dịch bị kết luận nhầm là chết,
 * hoặc một `askConfirm` thiếu tiêu đề lọt lưới. Bỏ qua đúng thư mục đã biết là rác thì phạm vi
 * hẹp và nói ra được lý do.
 */
export function scanSource(root: string, extension: RegExp): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const day = join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name.startsWith('__lint-probe__') ? [] : scanSource(day, extension);
    }
    return entry.isFile() && extension.test(entry.name) ? [day] : [];
  });
}
