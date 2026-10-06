import type { EnvelopeCryptoService } from '../../common/crypto/envelope.service';

/**
 * Khoá AES-256 web dùng mã bản vẽ đang vẽ dở trước khi cất vào IndexedDB (Q-23 06/10). Chỉ trả kèm
 * nội dung tab Sửa — tức sau khi đã nhập mã sơ đồ: trên đĩa chỉ có bản mã, ai không qua được mã sơ đồ
 * (cùng máy, người khác, hay đọc đĩa) không mở được bản vẽ dở. Theo người + bản vẽ, dẫn xuất từ
 * master key nên không phải lưu ở đâu.
 */
export function diagramDraftKey(crypto: Pick<EnvelopeCryptoService, 'deriveKey'>, userId: string, diagramId: string): string {
  return crypto.deriveKey(`diagram-draft|${userId}|${diagramId}`).toString('base64');
}
