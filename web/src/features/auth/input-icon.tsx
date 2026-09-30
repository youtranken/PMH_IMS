import { cloneElement, type ReactElement } from 'react';

type Passed = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  children: ReactElement<Record<string, unknown>>;
  icon: 'mail' | 'lock';
};

/**
 * Biểu tượng đứng đầu ô nhập của card đăng nhập.
 *
 * `Field` gắn `id`/`aria-*` vào ĐỨA CON TRỰC TIẾP của nó — ở đây là gói này, nên gói phải chuyển
 * tiếp chúng xuống ô thật; bọc bằng một `<span>` trơn thì nhãn không nối được vào ô. Giá trị ô tự
 * khai (vd `aria-describedby` trỏ tới lỗi đầu card) thắng giá trị `Field` đưa, như chính `Field`.
 */
export function InputIcon({ icon, children, ...fromField }: Passed) {
  const own = children.props as Record<string, unknown>;
  return (
    <span className="auth-inp-icon">
      <svg
        className="auth-inp-glyph"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icon === 'mail' ? (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </>
        ) : (
          <>
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </>
        )}
      </svg>
      {cloneElement(children, {
        id: own.id ?? fromField.id,
        'aria-describedby': own['aria-describedby'] ?? fromField['aria-describedby'],
        'aria-invalid': own['aria-invalid'] ?? fromField['aria-invalid'],
      })}
    </span>
  );
}
