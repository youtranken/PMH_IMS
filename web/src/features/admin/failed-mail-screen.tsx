import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DataTable } from '@/ui/data-table';
import { EmptyState, LoadError } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { useToast } from '@/ui/toast';

export interface FailedMail {
  id: string;
  topic: string;
  createdAt: string;
  failCount: number;
  lastError: string | null;
  lastFailedAt: string | null;
}

/** Khoá cho badge menu (`shell/use-failed-mail-count.ts`) nằm cùng nhánh: gửi lại xong badge về đúng số. */
export const FAILED_MAIL_KEY = ['outbox-failed'] as const;

/** Topic outbox → tên loại thư. Topic chưa có tên thì hiện nguyên mã: thư lạ vẫn phải thấy được. */
export const FAILED_MAIL_TOPIC_KEY: Record<string, string> = {
  'expiry.digest': 'failedMail.topics.expiryDigest',
  'approval.requested': 'failedMail.topics.approvalRequested',
  'approval.reminder': 'failedMail.topics.approvalReminder',
  'approval.decided': 'failedMail.topics.approvalDecided',
  'auth.account.locked': 'failedMail.topics.accountLocked',
  'security.probe.alert': 'failedMail.topics.securityProbe',
  'auth.device.new': 'failedMail.topics.newDevice',
  'account.created': 'failedMail.topics.accountCreated',
  'auth.password.changed': 'failedMail.topics.passwordChanged',
  'account.password.reset': 'failedMail.topics.passwordReset',
  'account.mfa.reset': 'failedMail.topics.mfaReset',
  'auth.totp.reenrolled': 'failedMail.topics.totpReenrolled',
  'diagram.drift': 'failedMail.topics.diagramDrift',
  'break_glass.code': 'failedMail.topics.breakGlassCode',
  'iso.reminder': 'failedMail.topics.isoReminder',
  'iso.period.event': 'failedMail.topics.isoPeriodEvent',
};

/**
 * Thư gửi lỗi (Q-25) — CHỈ SA. Thư đã hết lượt gửi tự động nằm ở đây cho tới khi SA "Gửi lại"
 * (relay đẩy lại đúng thư đó) hay sửa SMTP rồi gửi lại. Lỗi cuối đã được API che địa chỉ người nhận.
 */
export function FailedMailScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const list = useQuery({
    queryKey: FAILED_MAIL_KEY,
    queryFn: () => apiFetch<{ total: number; items: FailedMail[] }>('/api/v1/admin/outbox/failed'),
  });
  const topicLabel = (topic: string) => (FAILED_MAIL_TOPIC_KEY[topic] ? t(FAILED_MAIL_TOPIC_KEY[topic]) : topic);

  const columns = useMemo<ColumnDef<FailedMail, unknown>[]>(() => {
    const requeue = async (row: FailedMail) => {
      setBusy(row.id);
      try {
        await apiFetch(`/api/v1/admin/outbox/failed/${row.id}/requeue`, { method: 'POST', csrfToken: me.csrfToken });
        toast({ tone: 'ok', message: t('failedMail.requeued') });
      } catch (error) {
        toast({ tone: 'error', message: errorMessage(error) });
      } finally {
        setBusy(null);
        void queryClient.invalidateQueries({ queryKey: FAILED_MAIL_KEY });
      }
    };
    return [
      { id: 'topic', header: t('failedMail.colTopic'), accessorFn: (row) => topicLabel(row.topic) },
      { id: 'createdAt', header: t('failedMail.colCreated'), accessorFn: (row) => row.createdAt, cell: ({ row }) => formatDateTime(row.original.createdAt) },
      { id: 'failCount', header: t('failedMail.colAttempts'), accessorFn: (row) => row.failCount },
      { id: 'lastFailedAt', header: t('failedMail.colLastFailed'), accessorFn: (row) => row.lastFailedAt ?? '', cell: ({ row }) => formatDateTime(row.original.lastFailedAt) },
      { id: 'lastError', header: t('failedMail.colError'), accessorFn: (row) => row.lastError ?? '', enableSorting: false },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            className="btn sm"
            disabled={busy !== null}
            aria-label={t('failedMail.requeueOf', { topic: topicLabel(row.original.topic).toLowerCase() })}
            onClick={() => void requeue(row.original)}
          >
            {t('failedMail.requeue')}
          </button>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- topicLabel/toast ổn định theo `t`
  }, [t, busy, me.csrfToken, queryClient]);

  return (
    <>
      <PageHeader title={t('failedMail.title')} />
      {list.isError ? (
        <LoadError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data && list.data.items.length === 0 ? (
        /* Rỗng thì khung trống THAY bảng như mọi màn danh sách — không lồng khung đứt nét dưới
           một hàng tiêu đề cột không có dữ liệu nào. */
        <EmptyState title={t('failedMail.empty')} />
      ) : (
        <DataTable
          data={list.data?.items ?? []}
          columns={columns}
          loading={list.isPending}
          emptyText={t('failedMail.empty')}
          initialSort={[{ id: 'lastFailedAt', desc: true }]}
          stackOnMobile
        />
      )}
    </>
  );
}
