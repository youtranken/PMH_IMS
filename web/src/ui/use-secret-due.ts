import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type { SecretOwnerType } from '@/lib/secret-owner-kinds';

/** Hạn đổi mật khẩu trong két của một hồ sơ — `GET /vault/owners/due`. */
export interface SecretDueEntry {
  ownerId: string;
  valueChangedAt: string;
  dueInDays: number;
}

/**
 * Hạn đổi mật khẩu trong két của mọi hồ sơ một loại (Q-15, K-03): danh sách Thiết bị, bốn màn
 * phần mềm, Đường truyền và Tài khoản dịch vụ cùng hỏi qua đây. Hỏi `vault` từ MÀN HÌNH, không từ
 * module chủ: `vault` đã phụ thuộc các module đó, gọi ngược là vòng (AD-2). `enabled` = SA/Admin —
 * bản đồ két không mở cho Member.
 */
export function useSecretDue(ownerType: SecretOwnerType, enabled: boolean): Map<string, SecretDueEntry> {
  const due = useQuery({
    queryKey: ['vault', 'owners', 'due', ownerType],
    enabled,
    queryFn: () => apiFetch<SecretDueEntry[]>(`/api/v1/vault/owners/due?ownerType=${ownerType}`),
    // Một dòng phụ trong bảng — hỏng thì im, không kéo lỗi lên cả danh sách.
    retry: false,
  });
  return useMemo(() => new Map((Array.isArray(due.data) ? due.data : []).map((item) => [item.ownerId, item])), [due.data]);
}
