import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MasterKeyRing } from './master-key-ring';
import type { SealContext, SealedValue } from './envelope.types';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;

/**
 * Lõi mã hóa envelope (NFR-02) — dùng CHUNG cho TOTP secret (auth) và
 * két sắt (vault). AD-15: chỉ có MỘT bản cài đặt này, không module nào tự chế.
 *
 * Cách làm: mỗi giá trị sinh một DEK ngẫu nhiên → mã dữ liệu bằng DEK → bọc DEK bằng
 * master key. Xoay chìa = bọc lại DEK, KHÔNG phải mã lại toàn bộ dữ liệu.
 *
 * AAD = `table|record_id|key_version`: ciphertext gắn chết với đúng hàng của đúng bảng.
 */
@Injectable()
export class EnvelopeCryptoService {
  constructor(private readonly keyring: MasterKeyRing) {}

  get currentKeyVersion(): number {
    return this.keyring.currentVersion;
  }

  /** Mã hóa bằng master key hiện hành. */
  seal(plaintext: string | Buffer, context: SealContext): SealedValue {
    const keyVersion = this.keyring.currentVersion;
    const dek = randomBytes(DEK_BYTES);
    const aad = buildAad(context, keyVersion);

    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, dek, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv,
      tag,
      wrappedDek: this.wrapDek(dek, aad, keyVersion),
      keyVersion,
    };
  }

  /** Giải mã. Ném lỗi nếu AAD lệch (ciphertext bị bê sang hàng khác) hoặc tag sai. */
  open(sealed: SealedValue, context: SealContext): Buffer {
    const aad = buildAad(context, sealed.keyVersion);
    const dek = this.unwrapDek(sealed.wrappedDek, aad, sealed.keyVersion);
    const decipher = createDecipheriv(ALGO, dek, sealed.iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.tag);
    return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
  }

  openText(sealed: SealedValue, context: SealContext): string {
    return this.open(sealed, context).toString('utf8');
  }

  /**
   * Xoay chìa: mở DEK bằng chìa cũ, bọc lại bằng chìa hiện hành.
   * Dữ liệu KHÔNG bị mã lại → nhưng AAD có key_version nên phần dữ liệu phải mã lại
   * theo AAD mới. Ở quy mô IMS (vài nghìn secret) mã lại là chấp nhận được và an toàn hơn.
   */
  rewrap(sealed: SealedValue, context: SealContext): SealedValue {
    if (sealed.keyVersion === this.keyring.currentVersion) return sealed;
    const plaintext = this.open(sealed, context);
    try {
      return this.seal(plaintext, context);
    } finally {
      plaintext.fill(0);
    }
  }

  private wrapDek(dek: Buffer, aad: Buffer, keyVersion: number): Buffer {
    const masterKey = this.keyring.get(keyVersion);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, masterKey, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(aad);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]);
  }

  private unwrapDek(wrapped: Buffer, aad: Buffer, keyVersion: number): Buffer {
    if (wrapped.length !== IV_BYTES + TAG_BYTES + DEK_BYTES) {
      throw new Error('DEK bọc sai độ dài — dữ liệu hỏng hoặc không phải envelope IMS.');
    }
    const masterKey = this.keyring.get(keyVersion);
    const iv = wrapped.subarray(0, IV_BYTES);
    const tag = wrapped.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = wrapped.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGO, masterKey, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}

function buildAad(context: SealContext, keyVersion: number): Buffer {
  return Buffer.from(`${context.table}|${context.recordId}|${keyVersion}`, 'utf8');
}
