import type { ReactNode } from 'react';

/**
 * Đầu trang dùng chung (AD-15): tiêu đề + mô tả + vùng thao tác bên phải.
 * Mọi màn dùng cùng khoảng cách, cùng cỡ chữ — không màn nào tự dựng <h1> riêng.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="grow">
        <h1>{title}</h1>
        {subtitle ? <p className="sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

/**
 * Khối form có tiêu đề nhỏ (FORM SECTION) — dùng cho mọi form nhập liệu.
 * Style đã có sẵn trong css/form-layout.css.
 */
export function FormSection({
  title,
  children,
  columns = 3,
}: {
  title: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <section className="form-section">
      <h2 className="form-section-title">{title}</h2>
      <div className="form-grid" data-columns={columns}>
        {children}
      </div>
    </section>
  );
}

/** Một ô nhập có nhãn — gói lại để nhãn/khoảng cách/aria nhất quán toàn app. */
export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  span,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  span?: 2 | 3;
  children: ReactNode;
}) {
  return (
    <div className={`field${span ? ` span-${span}` : ''}`}>
      <label className="lbl-t" htmlFor={htmlFor}>
        {label}{' '}
        {/* Dấu * chỉ là chỉ dấu thị giác: aria-hidden để tên gọi trợ năng của ô nhập là
            đúng nhãn ("Email"), không thành "Email *". Bắt buộc thật nằm ở thuộc tính
            `required` của input. */}
        {required ? (
          <span className="req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint muted">{hint}</span>
      ) : null}
    </div>
  );
}
