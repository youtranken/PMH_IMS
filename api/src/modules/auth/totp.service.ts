import { Injectable } from '@nestjs/common';
import {
  NobleCryptoPlugin,
  ScureBase32Plugin,
  TOTP,
} from 'otplib';
import * as QRCode from 'qrcode';

const PERIOD_SECONDS = 30;
/** Chấp nhận lệch đồng hồ điện thoại ±30 giây (1 chu kỳ). */
const EPOCH_TOLERANCE = 30;
const ISSUER = 'IMS PMH';

export interface TotpVerifyResult {
  ok: boolean;
  /** Time step đã dùng — PHẢI lưu vào users.totp_last_timestep để chặn replay (NFR-01). */
  timeStep?: number;
  reason?: 'invalid' | 'replayed';
}

/**
 * TOTP (AD-8, NFR-01) — otplib 13 + chống replay.
 *
 * Chống replay: mã 6 số sống 30 giây nên ai nhìn trộm được có thể dùng lại trong cửa sổ đó.
 * Mỗi lần verify thành công ta lưu `timeStep`; lần sau truyền lại qua `afterTimeStep`,
 * otplib từ chối mọi mã có timeStep <= mốc đã dùng.
 */
@Injectable()
export class TotpService {
  private readonly totp = new TOTP({
    crypto: new NobleCryptoPlugin(),
    base32: new ScureBase32Plugin(),
    period: PERIOD_SECONDS,
    digits: 6,
    issuer: ISSUER,
  });

  /** Secret base32 mới cho lần enroll — PHẢI envelope trước khi ghi DB (AD-4). */
  generateSecret(): string {
    return this.totp.generateSecret();
  }

  keyUri(email: string, secret: string): string {
    return this.totp.toURI({ secret, label: email, issuer: ISSUER });
  }

  async qrDataUrl(email: string, secret: string): Promise<string> {
    return QRCode.toDataURL(this.keyUri(email, secret));
  }

  async generateFor(secret: string, epochSeconds: number): Promise<string> {
    const result = await this.totp.generate({ secret, epoch: epochSeconds });
    return typeof result === 'string' ? result : String(result);
  }

  async verify(params: {
    token: string;
    secret: string;
    lastUsedTimeStep: number | null;
    now?: Date;
  }): Promise<TotpVerifyResult> {
    const token = params.token.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(token)) return { ok: false, reason: 'invalid' };

    const epoch = Math.floor((params.now ?? new Date()).getTime() / 1000);
    const attempt = async (afterTimeStep?: number) =>
      this.totp.verify(token, {
        secret: params.secret,
        epoch,
        epochTolerance: EPOCH_TOLERANCE,
        ...(afterTimeStep === undefined ? {} : { afterTimeStep }),
      });

    const guarded = await attempt(params.lastUsedTimeStep ?? undefined);
    if (guarded.valid) {
      return { ok: true, timeStep: guarded.timeStep };
    }
    // Phân biệt "mã sai" với "mã đúng nhưng đã dùng rồi" — thông điệp cho user khác nhau,
    // và audit cần biết đây là dấu hiệu bị chộp mã.
    if (params.lastUsedTimeStep !== null) {
      const unguarded = await attempt();
      if (unguarded.valid) return { ok: false, reason: 'replayed' };
    }
    return { ok: false, reason: 'invalid' };
  }
}
