import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useApiMutation } from '@/lib/api';
import { afterLogout } from '@/lib/after-logout';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { ThemeChoice } from '@/ui/theme-choice';
import { useToast } from '@/ui/toast';

/**
 * Khối người dùng ở chân sidebar = nút mở menu tài khoản (WAI-ARIA menu button).
 *
 * Đây là LỐI VÀO DUY NHẤT tới Hồ sơ của tôi, đổi mật khẩu và cài lại 2 lớp khi đã đăng nhập —
 * câu báo lỗi `TOTP_NOT_ENROLLED` của API chỉ người dùng tới đây. Trên điện thoại nó nằm trong
 * drawer cùng sidebar, nên không cần một bản thứ hai ở topbar.
 *
 * Bàn phím: mở thì tiêu điểm vào mục đầu; ↑/↓ đi vòng (←/→ cũng vậy — hàng Giao diện nằm ngang),
 * Home/End về đầu/cuối; Esc (và Tab) đóng
 * rồi trả tiêu điểm về nút — không trả thì người dùng bàn phím rơi về đầu trang.
 */
export function AccountMenu({ me, initials, roleLabel }: { me: Me; initials: string; roleLabel: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const logout = useApiMutation<undefined, { status: string }>('/api/v1/auth/logout', {
    csrfToken: me.csrfToken,
  });

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  // Bấm ra ngoài thì đóng, KHÔNG kéo tiêu điểm về nút: người dùng vừa chủ động bấm chỗ khác.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const go = (to: string) => {
    close(false);
    navigate(to);
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) => list[(i + list.length) % list.length]?.focus();
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        focusAt(at + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        focusAt(at - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(list.length - 1);
        break;
      case 'Escape':
        // Dừng ở đây: Esc thứ nhất đóng menu, không được rơi xuống đóng luôn drawer.
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  };

  return (
    <>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={t('profile.accountMenu', { name: me.fullName })}
        className={open ? 'sb-actions open' : 'sb-actions'}
        onKeyDown={onMenuKey}
        hidden={!open}
      >
        <button type="button" role="menuitem" tabIndex={-1} className="sb-act" onClick={() => go(PATHS.profile)}>
          {t('profile.menuProfile')}
        </button>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="sb-act"
          onClick={() => go(`${PATHS.profile}?open=password`)}
        >
          {t('profile.menuChangePassword')}
        </button>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="sb-act"
          onClick={() => go(`${PATHS.profile}#xac-thuc-2-lop`)}
        >
          {t('profile.menuTotp')}
        </button>
        {/* Một hàng ba nút biểu tượng như nút ở topbar, không phải ba dòng chữ có dấu ✓ (Q-20). */}
        <div className="sb-theme">
          <span className="sb-act-label" aria-hidden="true">
            {t('profile.menuAppearance')}
          </span>
          <ThemeChoice label={t('profile.menuAppearance')} compact inMenu />
        </div>
        <div role="separator" className="sb-sep" />
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="sb-act danger"
          disabled={logout.isPending}
          onClick={() => {
            // onSettled chứ không onSuccess: đăng xuất lỗi (mất mạng, lệch CSRF) cũng không được
            // để lại dữ liệu người trước trên máy dùng chung (FE-02).
            logout.mutate(undefined, {
              // Lỗi thì PHẢI nói ra: phiên phía máy chủ có thể vẫn sống, và người dùng tưởng đã
              // thoát trên một máy dùng chung. Toast sống ngoài router nên vẫn hiện sau khi chuyển trang.
              onError: () =>
                toast({ message: t('auth.logoutFailed'), tone: 'error', durationMs: 10_000 }),
              onSettled: () => afterLogout(queryClient, navigate),
            });
          }}
        >
          {t('common.logout')}
        </button>
      </div>
      <div className="sb-user">
        <button
          ref={buttonRef}
          type="button"
          className="sb-userbtn"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={t('profile.accountMenu', { name: me.fullName })}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="sb-av" aria-hidden="true">
            {initials}
          </span>
          <span className="sb-who">
            <b title={me.fullName}>{me.fullName}</b>
            <span>{roleLabel}</span>
          </span>
        </button>
      </div>
    </>
  );
}
