import { useEffect, useRef, useState, type InputHTMLAttributes, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  ref?: Ref<HTMLInputElement>;
};

/**
 * Ô mật khẩu có nút hiện/ẩn (AD-15) — đăng nhập, đổi mật khẩu, hỏi lại mật khẩu khi cài 2 lớp.
 *
 * Mật khẩu ở đây dài ≥12 ký tự, 3/4 nhóm, và hay được gõ trên bàn phím điện thoại; mỗi lần gõ
 * sai còn đẩy bộ đếm tạm khoá lên một bậc. Cho xem lại chuỗi vừa gõ rẻ hơn nhiều so với một
 * lần khoá.
 *
 * Mọi prop khác (id, aria-describedby, aria-invalid mà `Field` gắn vào) đi thẳng xuống `<input>`,
 * nên đặt nó trong `Field` y như một `<input>` thường.
 *
 * Tự che lại khi form được gửi: chuỗi đang hiện không được nằm trên màn sau khi người dùng đã
 * xong việc với nó (máy dùng chung, người đứng sau lưng).
 */
export function PasswordInput({ ref, className, ...rest }: Props) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const inner = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const form = inner.current?.form;
    if (!form) return;
    const hide = () => setShown(false);
    form.addEventListener('submit', hide);
    return () => form.removeEventListener('submit', hide);
  }, []);

  return (
    <span className="pw-input">
      <input
        {...rest}
        ref={(node) => {
          inner.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        className={className ?? 'inp'}
        type={shown ? 'text' : 'password'}
        // Chuỗi đang hiện thì bàn phím điện thoại không được tự sửa chính tả hay viết hoa nó.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="pw-toggle"
        aria-label={shown ? t('auth.hidePassword') : t('auth.showPassword')}
        aria-pressed={shown}
        aria-controls={rest.id}
        onClick={() => {
          setShown((v) => !v);
          inner.current?.focus();
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
          {shown ? <path d="M4 4l16 16" /> : null}
        </svg>
      </button>
    </span>
  );
}
