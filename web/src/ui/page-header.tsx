import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

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
  /**
   * Tiêu đề khu. BỎ TRỐNG khi khu chỉ có một ô mà nhãn ô đã nói đúng điều đó — form tài khoản
   * dịch vụ từng in "Ghi chú" hai lần chồng nhau, cách nhau 8px, vì tiêu đề khu và nhãn ô là
   * cùng một chữ (rà UI/UX 12/09, mục #35).
   *
   * Không bỏ trống chỉ để cho gọn: khu có từ hai ô trở lên thì tiêu đề là thứ nói cho người
   * đọc biết mấy ô ấy thuộc về nhau.
   */
  title?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
}) {
  return (
    <section className="form-section">
      {title ? <h2 className="form-section-title">{title}</h2> : null}
      <div className="form-grid" data-columns={columns}>
        {children}
      </div>
    </section>
  );
}

/**
 * Đứa con của `Field` có phải thứ ĐEO ĐƯỢC `id` của nhãn hay không.
 *
 * ===== HỒI QUY ĐÃ DÍNH, 24/09 — VÀ CHỈ E2E BẮT ĐƯỢC =====
 *
 * Bản đầu gắn `id` vào BẤT KỲ phần tử con nào. Ở `catalog-form.tsx:246` con của `Field` là một
 * `<label className="row">` BỌC NGOÀI cái checkbox thật, và checkbox ấy đã tự khai
 * `id="catalog-portmap"` — đúng cái id mà `Field` đang dùng. Kết quả: HAI phần tử mang cùng một
 * `id`, `htmlFor` phân giải vào phần tử ĐẦU TIÊN (cái `<label>` bọc, không phải điều khiển),
 * nên nhãn của `Field` thôi nối vào checkbox và tên trợ năng của nó rơi về câu gợi ý dài bên
 * trong. Tên đổi từ "Có port map" thành "Loại này sẽ hiện bảng port map ở trang chi tiết…".
 *
 * Vitest 519/519 xanh suốt vì không bài nào dựng đúng hình dạng "Field bọc một label bọc một
 * input". Bài E2E `di-khap-giao-dien` — vốn đếm TÊN TRỢ NĂNG của từng điều khiển trong hộp —
 * là thứ duy nhất bắt được. Chú thích cũ của tôi ghi "đứa con không nhận `id` thì phép gắn
 * lặng lẽ không làm gì"; sai — nó làm SAI, chứ không phải không làm.
 *
 * ===== LUẬT =====
 *
 * · thẻ HTML trần: chỉ gắn cho phần tử NHÃN NỐI ĐƯỢC (`<label for>` hợp lệ với chúng);
 * · component (hàm): gắn — `Select` và `Combobox` đều nhận `id` rồi chuyển xuống phần tử thật,
 *   và `field-a11y.test.tsx` dựng thật cả hai để chắc chuyện đó;
 * · còn lại (`<div>`, `<label>`, mảnh ghép, chuỗi): KHÔNG gắn, để nơi gọi tự lo như trước.
 */
const LABELABLE = new Set(['input', 'select', 'textarea', 'button', 'meter', 'output', 'progress']);

function canTakeId(children: ReactNode): children is ReactElement<Record<string, unknown>> {
  if (!isValidElement(children)) return false;
  const type = (children as ReactElement).type;
  return typeof type === 'string' ? LABELABLE.has(type) : true;
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
  /**
   * Ô bắt buộc — vẽ dấu `*` và, với `Select`/`Combobox`, kéo theo `aria-required`/`required`.
   *
   * ===== DẤU `*` CHỈ CÓ NGHĨA KHI NÓ PHÂN BIỆT ĐƯỢC CÁI GÌ =====
   *
   * Rà UI/UX 12/09 (mục #24) liệt kê "4 màn `auth/` không có dấu nào" như một chỗ thiếu. Tôi
   * đã đi thêm dấu vào đó, rồi nhận ra đó là bản vá SAI — và nhận ra theo cách đắt nhất: bốn
   * nhãn ấy làm `getByLabel('Mật khẩu', { exact: true })` trong `helpers.ts` không khớp nữa
   * (Playwright khớp theo TEXT của thẻ nhãn, kể cả phần `aria-hidden`), nên MỌI bài E2E đỏ.
   *
   * Nhưng lý do bỏ dấu không phải vì bài kiểm đỏ. Màn đăng nhập có hai ô, cả hai bắt buộc;
   * màn đổi mật khẩu có ba ô, cả ba bắt buộc. Đánh dấu MỌI ô là nói không được điều gì —
   * giá trị của dấu `*` đến từ việc nó tách ô bắt buộc khỏi ô không bắt buộc. Form nghiệp vụ
   * thì có trộn thật (Mã* Tên* Loại* cạnh Model, Serial, Ghi chú), và đó là chỗ nó đáng có.
   *
   * Cùng lý do đã bỏ dấu ở hai màn dùng `OtpInput`: một ô duy nhất, bắt buộc hiển nhiên.
   */
  required?: boolean;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  span?: 2 | 3;
  children: ReactNode;
}) {
  /*
   * ===== `Field` TỰ NỐI NHÃN, GỢI Ý VÀ LỖI VÀO Ô NHẬP (F-06, 23/09) =====
   *
   * Trước đây `htmlFor` là việc của NƠI GỌI, và 56 trên 145 chỗ gọi không truyền — nhãn không
   * nối được vào ô, bấm vào nhãn không xảy ra gì, và `getByLabel` của bài kiểm không tìm ra.
   * Tám trong số đó thì ô con cũng không có tên trợ năng nào, tức hoàn toàn câm.
   *
   * Và `aria-describedby` thì **0 lần trong cả `web/src`**: `hint`/`error` chỉ là chữ nằm
   * cạnh ô, trình đọc màn hình không biết chúng thuộc về ô nào — người dùng nghe "Mật khẩu,
   * ô nhập" rồi tự đoán, trong khi dòng gợi ý ngay dưới đang nói "tối thiểu 12 ký tự".
   *
   * Cách sửa hiển nhiên là đi sửa 56 nơi gọi. Nhưng nơi gọi thứ 146 sẽ quên, và quên thì
   * KHÔNG gì đỏ — form vẫn dựng ra bình thường. Nên `Field` tự làm: nó sinh một `id` khi nơi
   * gọi không cho, rồi GẮN id ấy cùng `aria-describedby` vào chính đứa con của nó.
   *
   * Không đè lên thứ nơi gọi đã tự khai: một ô đã có `id` riêng (để `Select` và `<input>` thay
   * nhau ở cùng một chỗ, hoặc để bài kiểm bám vào) thì giữ nguyên id ấy.
   *
   * Đứa con không nhận `id`/`aria-describedby` thì phép gắn này lặng lẽ không làm gì — đó là
   * lý do `page-header.test.tsx` dựng thật từng loại điều khiển trong `Field` rồi ĐO lại, thay
   * vì tin rằng đã gắn.
   */
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const control = canTakeId(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? id,
        'aria-describedby':
          (children.props as { 'aria-describedby'?: string })['aria-describedby'] ?? describedBy,
        // Viền đỏ (`shared-kit.css`) và tiêu điểm của `useFormErrors` đều bám vào thuộc tính
        // này, và trình đọc màn hình đọc "không hợp lệ" nhờ nó.
        'aria-invalid':
          (children.props as { 'aria-invalid'?: boolean })['aria-invalid'] ??
          (error ? true : undefined),
      })
    : children;

  return (
    <div className={`field${span ? ` span-${span}` : ''}`}>
      <label className="lbl-t" htmlFor={id}>
        {label}{' '}
        {/* Dấu * chỉ là chỉ dấu thị giác: aria-hidden để tên gọi trợ năng của ô nhập là
            đúng nhãn ("Email"), không thành "Email *". Chặn thật nằm ở `useFormErrors` của
            form (form đặt `noValidate`); `required` trên ô để trình đọc màn hình đọc "bắt buộc". */}
        {/*
          `field-req`, KHÔNG phải `req` (sửa 12/09).

          `form-layout.css:211` khai `.field-req { color: var(--danger) }`, nhưng chỗ này viết
          `className="req"` — một lớp không tồn tại. Nên dấu `*` vẫn hiện, chỉ là cùng màu với
          nhãn: đúng cái bẫy `CLAUDE.md` cảnh báo cho `.dark` — một khối CSS hợp lệ mà không
          bao giờ chạy, và không có gì đỏ vì trang vẫn dựng ra bình thường.
        */}
        {required ? (
          <span className="field-req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {control}
      {/*
        LỖI VÀ GỢI Ý KHÔNG LOẠI TRỪ NHAU (12/09).

        Bản cũ dùng `error ? … : hint ? …`, nên đúng lúc ô vừa báo sai thì dòng gợi ý biến
        mất — trong khi gợi ý thường chính là thứ nói cho người dùng biết viết thế nào cho
        đúng ("Tối thiểu 12 ký tự, có ít nhất 3 trong 4 nhóm…"). Giấu nó đi ở đúng khoảnh
        khắc người ta cần là biến một lần gõ sai thành một vòng thử-và-đoán.

        Thứ tự: lỗi TRƯỚC (đỏ, `role="alert"`, trình đọc màn hình đọc ngay), gợi ý ở dưới.
      */}
      {error ? (
        <span className="field-error" role="alert" id={errorId}>
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="field-hint muted" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
