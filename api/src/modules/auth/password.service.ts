import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';
import { readSecretFile } from '../../common/secrets';

/**
 * Tham số Argon2id (NFR-01). OWASP 2024 khuyến nghị tối thiểu 19 MiB + 2 lần lặp;
 * lấy 64 MiB vì máy LAN 5 user, đăng nhập thưa — đắt cho kẻ dò, không cảm nhận với người thật.
 */
const ARGON_OPTIONS = {
  // Algorithm.Argon2id — dùng giá trị số vì `Algorithm` là ambient const enum,
  // không truy cập được khi bật isolatedModules (tsconfig).
  algorithm: 2,
  memoryCost: 65_536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

/**
 * Băm/kiểm mật khẩu Argon2id + pepper (NFR-01, AD-8).
 *
 * Pepper là bí mật NGOÀI database (docker secret): dump DB rơi ra ngoài mà không kèm
 * pepper thì hash vô dụng. Salt do Argon2 tự sinh cho từng hash.
 */
@Injectable()
export class PasswordService {
  constructor(private readonly pepper: string) {}

  static fromSecretFile(envVar = 'PASSWORD_PEPPER_FILE'): PasswordService {
    const pepper = readSecretFile(envVar);
    if (pepper.length < 32) {
      throw new Error(
        'Pepper phải dài ít nhất 32 ký tự (sinh bằng `openssl rand -hex 32`) — api từ chối khởi động.',
      );
    }
    return new PasswordService(pepper);
  }

  async hash(plain: string): Promise<string> {
    return hash(this.season(plain), ARGON_OPTIONS);
  }

  /** Không ném lỗi khi hash hỏng — trả false để luồng đăng nhập xử như sai mật khẩu. */
  async verify(hashed: string, plain: string): Promise<boolean> {
    try {
      return await verify(hashed, this.season(plain), ARGON_OPTIONS);
    } catch {
      return false;
    }
  }

  private season(plain: string): string {
    return `${plain}${this.pepper}`;
  }
}
