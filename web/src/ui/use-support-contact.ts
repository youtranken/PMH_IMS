import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * Câu "liên hệ ai" (`auth.support_contact`, AD-11) — route công khai nên dùng được cả khi chưa
 * đăng nhập. Chỉ tải khi `enabled`: phần lớn màn hình không bao giờ cần nó.
 */
export function useSupportContact(enabled: boolean) {
  return useQuery({
    queryKey: ['auth', 'support-contact'],
    queryFn: () => apiFetch<{ contact: string }>('/api/v1/auth/support-contact'),
    enabled,
    staleTime: 5 * 60_000,
  });
}
