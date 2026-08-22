import { SetMetadata } from '@nestjs/common';

export const ALLOW_TOTP_PENDING_KEY = 'ims:allow_totp_pending';

/**
 * Route dùng được khi phiên mới qua bước mật khẩu, CHƯA qua TOTP (nhập mã, enroll, logout).
 * Mặc định mọi route khác đều bị SessionGuard chặn cho tới khi TOTP xong (NFR-01).
 */
export const AllowTotpPending = () => SetMetadata(ALLOW_TOTP_PENDING_KEY, true);
