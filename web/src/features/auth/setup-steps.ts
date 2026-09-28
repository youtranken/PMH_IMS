import { useState } from 'react';
import { pendingSetupSteps, setupProgress, type Me, type SetupStep } from '@/lib/me';

/** `id` của hộp lỗi đầu card — ô nhập trỏ `aria-describedby` vào đây khi lỗi nói về chính nó. */
export const AUTH_ERROR_ID = 'auth-error';

const SETUP_TOTAL_KEY = 'ims_setup_total';

const STEP_LABEL: Record<SetupStep, string> = {
  totpEnroll: 'auth.stepTotpEnroll',
  changePassword: 'auth.stepChangePassword',
};

/**
 * Bước hiện tại của luồng cài đặt lần đầu, hoặc `null` khi chỉ còn một bước (không cần đánh số).
 * Tổng số bước nhớ trong sessionStorage theo email: xong bước 1 thì `me` thôi nhắc tới nó.
 */
export function useSetupStep(me: Me | null): { current: number; total: number; label: string } | null {
  const remaining = pendingSetupSteps(me);
  const [seen] = useState(() => readSeenTotal(me?.email));
  if (!me || remaining.length === 0) return null;
  const progress = setupProgress(remaining.length, seen);
  if (progress.total > seen) writeSeenTotal(me.email, progress.total);
  if (progress.total < 2) return null;
  return { ...progress, label: STEP_LABEL[remaining[0]] };
}

function readSeenTotal(email: string | undefined): number {
  if (!email) return 0;
  try {
    const raw = JSON.parse(sessionStorage.getItem(SETUP_TOTAL_KEY) ?? 'null') as {
      email?: string;
      total?: number;
    } | null;
    return raw?.email === email && typeof raw.total === 'number' ? raw.total : 0;
  } catch {
    return 0;
  }
}

function writeSeenTotal(email: string, total: number): void {
  try {
    sessionStorage.setItem(SETUP_TOTAL_KEY, JSON.stringify({ email, total }));
  } catch {
    // Kho bị chặn thì chỉ mất chữ "Bước 2/2" ở màn sau — không đáng chặn luồng đăng nhập.
  }
}

/**
 * Gọi ở màn đăng nhập: một lượt đăng nhập mới là một luồng mới. Không xoá thì hôm sau SA đặt lại
 * mật khẩu (chỉ còn một bước) mà tab cũ vẫn nhớ "tổng 2" và tự xưng "Bước 2/2".
 */
export function clearSetupSteps(): void {
  try {
    sessionStorage.removeItem(SETUP_TOTAL_KEY);
  } catch {
    // Kho bị chặn thì cũng không có gì đã ghi để xoá.
  }
}
