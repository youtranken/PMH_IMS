import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { PATHS } from '@/lib/routes';
import { BREAK_GLASS_KEY } from '@/ui/break-glass';
import type { AccountRef } from './account-dialogs';

/**
 * Những thứ một người CÒN GIỮ, kèm con số: dòng quyền két, yêu cầu mở két đang chờ, thiết bị
 * ghi tên họ. Hộp Vô hiệu hóa và hộp Chi tiết tài khoản cùng dùng.
 *
 * Chỉ đọc qua đúng các endpoint danh sách của từng module (quyền do module đó gác). Vô hiệu hóa
 * KHÔNG tự gỡ các thứ này: gỡ quyền két hay huỷ yêu cầu là quyết định riêng của người quản trị,
 * và mỗi việc đã có màn của nó với hộp hỏi lại + ghi vết.
 *
 * Thiết bị đếm theo tìm tên (ô "Người sử dụng" là chữ tự do, không nối với tài khoản), nên nhãn
 * nói "khớp tên" chứ không nói "đang giữ". Nguồn nào hỏng thì nói không đếm được — không in 0.
 */
export function AccountFootprint({ account }: { account: AccountRef }) {
  const { t } = useTranslation();
  const member = account.role === 'member';

  const rules = useQuery({
    queryKey: ['vault', 'access', 'member', account.email],
    enabled: member,
    queryFn: () =>
      apiFetch<unknown[]>(`/api/v1/vault/access?memberEmail=${encodeURIComponent(account.email)}`),
  });
  const pending = useQuery({
    // Cùng khoá và cùng dữ liệu với khối "Cần duyệt" của trang chủ — một lượt hỏi cho cả hai.
    queryKey: [...BREAK_GLASS_KEY, 'pending'],
    queryFn: () => apiFetch<{ id: string; requester: string }[]>('/api/v1/vault/break-glass/pending'),
  });
  const devices = useQuery({
    queryKey: ['devices', 'footprint', account.fullName],
    queryFn: () =>
      apiFetch<{ total: number }>(
        `/api/v1/devices?page=1&limit=1&search=${encodeURIComponent(account.fullName)}`,
      ),
  });

  const email = account.email.toLowerCase();
  const mine = (pending.data ?? []).filter((row) => row.requester.toLowerCase() === email).length;

  const line = (
    to: string,
    query: { isLoading: boolean; isError: boolean },
    count: number | undefined,
    countKey: string,
    failedKey: string,
  ) => (
    <li>
      <Link to={to}>
        {query.isLoading
          ? t('accounts.footprintCounting')
          : query.isError || count === undefined
            ? t(failedKey)
            : t(countKey, { count })}
      </Link>
    </li>
  );

  return (
    <ul className="account-footprint">
      {member ? (
        line(
          `${PATHS.adminVaultAccess}?user=${encodeURIComponent(account.id)}`,
          rules,
          rules.data?.length,
          'accounts.footprintVault',
          'accounts.footprintVaultFailed',
        )
      ) : (
        <li className="muted">{t('accounts.footprintVaultRole')}</li>
      )}
      {line(
        PATHS.approvals,
        pending,
        pending.data ? mine : undefined,
        'accounts.footprintRequests',
        'accounts.footprintRequestsFailed',
      )}
      {line(
        `${PATHS.devices}?q=${encodeURIComponent(account.fullName)}`,
        devices,
        devices.data?.total,
        'accounts.footprintDevices',
        'accounts.footprintDevicesFailed',
      )}
    </ul>
  );
}
