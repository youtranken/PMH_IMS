import type { Request } from 'express';

/** Vai trò (NFR-01). Thứ tự KHÔNG mang ý nghĩa cấp bậc — quyền kiểm bằng RolesGuard. */
export type UserRole = 'sa' | 'admin' | 'member';

/** Danh tính gắn vào request sau khi SessionGuard xác thực cookie phiên. */
export interface AuthedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  sessionId: string;
  /** Mốc gõ TOTP gần nhất trong phiên — FR-022 tính grace từ đây. */
  steppedUpAt: Date | null;
  mustChangePassword: boolean;
}

/**
 * AD-12: type thuần, KHÔNG import service — tránh vòng phụ thuộc guard ↔ service
 * (bài học QLTS: `AuthedRequest` nằm trong identity.guard.ts kéo cả guard vào mọi controller).
 */
export interface AuthedRequest extends Request {
  user?: AuthedUser;
}
