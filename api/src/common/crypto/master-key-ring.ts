import { readSecretFile } from '../secrets';

/**
 * Chùm master key (NFR-02). File docker secret, mỗi dòng `<version>=<64 hex>`:
 *
 *     1=9f2c...   ← chìa cũ, còn giữ để giải dữ liệu chưa xoay
 *     2=41ab...   ← chìa hiện hành (version lớn nhất), dùng để MÃ MỚI
 *
 * Sinh chìa: `openssl rand -hex 32`. In giấy 2 phong bì 2 người giữ (NFR-02).
 */
export class MasterKeyRing {
  private readonly keys = new Map<number, Buffer>();
  readonly currentVersion: number;

  constructor(raw: string) {
    for (const line of raw.split('\n')) {
      const text = line.trim();
      if (!text || text.startsWith('#')) continue;
      const match = /^(\d+)\s*=\s*([0-9a-fA-F]{64})$/.exec(text);
      if (!match) {
        throw new Error(
          'Dòng master key sai định dạng — cần `<version>=<64 ký tự hex>` (NFR-02).',
        );
      }
      const version = Number.parseInt(match[1], 10);
      if (this.keys.has(version)) {
        throw new Error(`Master key version ${version} khai trùng.`);
      }
      this.keys.set(version, Buffer.from(match[2], 'hex'));
    }
    if (this.keys.size === 0) {
      throw new Error('Chùm master key rỗng — api từ chối khởi động (NFR-02).');
    }
    this.currentVersion = Math.max(...this.keys.keys());
  }

  static fromSecretFile(envVar = 'MASTER_KEY_FILE'): MasterKeyRing {
    return new MasterKeyRing(readSecretFile(envVar));
  }

  get(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(
        `Không có master key version ${version} trong chùm — dữ liệu cũ sẽ không giải được. ` +
          'Giữ lại chìa cũ trong file cho tới khi xoay xong toàn bộ (NFR-02).',
      );
    }
    return key;
  }

  get versions(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b);
  }
}
