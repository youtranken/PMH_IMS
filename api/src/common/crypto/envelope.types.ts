/** Một giá trị đã mã hóa envelope — đủ để cất vào 5 cột của bảng chủ (NFR-02). */
export interface SealedValue {
  /** Ciphertext của dữ liệu, mã bằng DEK. */
  ciphertext: Buffer;
  /** IV 12 byte của lần mã dữ liệu. */
  iv: Buffer;
  /** Auth tag GCM của dữ liệu. */
  tag: Buffer;
  /** DEK đã bọc bằng master key: iv(12) || tag(16) || ciphertext(32). */
  wrappedDek: Buffer;
  /** Phiên bản master key đã dùng để bọc DEK — phục vụ xoay chìa. */
  keyVersion: number;
}

/**
 * Ngữ cảnh ràng buộc (AAD) — NFR-02: `record_id + key_version + table`.
 * Ciphertext bê từ hàng này sang hàng khác sẽ KHÔNG giải được.
 */
export interface SealContext {
  table: string;
  recordId: string;
}
