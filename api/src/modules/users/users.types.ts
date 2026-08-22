import type { UserRole } from '../auth/types';

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: 'active' | 'locked' | 'disabled';
  mustChangePassword: boolean;
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
