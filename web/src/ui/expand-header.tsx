import type { ReactNode } from 'react';

/**
 * Đầu khu bung dòng của `DataTable` (`renderExpanded`): tiêu đề · số đếm · ghi chú · nút thao
 * tác chính ở mép phải.
 *
 * Mẫu bung dòng là MỘT cho mọi bảng: mũi tên trơn ở cột đầu (tên của nó mang số đếm qua
 * `expandLabel`), còn số đếm để MẮT đọc thì nằm ở đây, trong khu vừa bung. Mỗi màn tự dựng đầu
 * khu riêng thì /devices và /software lại lệch nhau (Q-18).
 */
export function ExpandHeader({
  title,
  count,
  note,
  action,
}: {
  title: string;
  /** Số đếm cạnh tiêu đề ("3", "5/10"). `0` vẫn hiện — khu rỗng phải nói là rỗng. */
  count?: number | string;
  /** Một mẩu cảnh báo ngắn sau số đếm ("Hết ghế") — màu cảnh báo. */
  note?: ReactNode;
  /** Nút thao tác chính của khu (vd "Gán vào máy"), đứng mép phải. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="exp-head">
      <span className="exp-head-title">{title}</span>
      {count != null ? <span className="exp-head-count">{count}</span> : null}
      {note ? <span className="exp-head-note">{note}</span> : null}
      {action ? (
        <button
          type="button"
          className="btn sm primary"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
