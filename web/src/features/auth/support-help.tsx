import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSupportContact } from '@/ui/use-support-contact';

/**
 * "Không lấy được mã?" ở màn mã 2 lớp — chỉ đường tới người quản trị (Q-14: KHÔNG có luồng tự
 * đặt lại qua email; Q-18: màn đăng nhập không còn "Quên mật khẩu?"). Câu liên hệ đọc từ
 * `system_config` qua route công khai, để IT đổi số điện thoại hay tên người trực mà không phải
 * dựng lại ảnh (AD-11).
 */
export function SupportHelp() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const contact = useSupportContact(open);

  return (
    <>
      <button
        type="button"
        className="auth-link"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? t('auth.hideHelp') : t('auth.lostTotp')}
      </button>
      {open ? (
        <div className="auth-help" id={panelId} role="region" aria-label={t('auth.lostTotp')}>
          <p>{t('auth.lostTotpHelp')}</p>
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
