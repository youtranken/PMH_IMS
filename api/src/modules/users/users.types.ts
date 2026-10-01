import type { UserRole } from '../auth/types';

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  employeeCode: string | null;
  /** Dạng `YYYY-MM-DD` — cột `date`, không mang giờ nên không lệch theo múi giờ. */
  birthDate: string | null;
  role: UserRole;
  status: 'active' | 'locked' | 'disabled';
  mustChangePassword: boolean;
  /** Mật khẩu tạm dùng được tới lúc này (Q-20); NULL khi không có hạn. */
  tempPasswordExpiresAt: Date | null;
  totpEnrolledAt: Date | null;
  totpLoginRequired: boolean;
  failedAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/** Bản ghi kèm bí mật — CHỈ module auth được chạm, không lọt ra controller. */
export interface UserCredentials extends UserRecord {
  passwordHash: string;
  totpSecretCt: Buffer | null;
  totpSecretIv: Buffer | null;
  totpSecretTag: Buffer | null;
  totpDekWrapped: Buffer | null;
  totpKeyVersion: number | null;
  totpLastTimestep: number | null;
}

/** Một người trong danh bạ tối thiểu — màn gán quyền cần biết ai là ai, không cần hơn. */
export interface UserDirectoryEntry {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: UserRecord['status'];
}
