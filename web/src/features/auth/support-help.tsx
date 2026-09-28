import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';

/**
 * "Quên mật khẩu?" / "Không lấy được mã?" — chỉ đường tới người quản trị (Q-14: KHÔNG có luồng
 * tự đặt lại qua email). Câu liên hệ đọc từ `system_config` qua route công khai, để IT đổi số
 * điện thoại hay tên người trực mà không phải dựng lại ảnh (AD-11).
 */
export function SupportHelp({ kind }: { kind: 'password' | 'totp' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const contact = useQuery({
    queryKey: ['auth', 'support-contact'],
    queryFn: () => apiFetch<{ contact: string }>('/api/v1/auth/support-contact'),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  return (
    <>
      <button
        type="button"
        className="auth-link"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t('auth.hideHelp') : t(kind === 'password' ? 'auth.forgotPassword' : 'auth.lostTotp')}
      </button>
      {open ? (
        <div className="auth-help" id={panelId} role="region" aria-label={t(kind === 'password' ? 'auth.forgotPassword' : 'auth.lostTotp')}>
          <p>{t(kind === 'password' ? 'auth.forgotPasswordHelp' : 'auth.lostTotpHelp')}</p>
          {contact.data ? (
            <p>
              <strong>{t('auth.supportContactLabel')}:</strong> {contact.data.contact}
            </p>
          ) : contact.isLoading ? (
            <p>{t('common.loading')}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
