import type { ComponentProps, ReactNode } from 'react';
import { ExpandHeader } from '@/ui/expand-header';

/**
 * Khung của MỌI khu bung dòng (`DataTable renderExpanded`): đầu khu chuẩn (`ExpandHeader`) và
 * thân, trong cùng một hộp có đệm, thụt vào thẳng cột mã của bảng cha.
 *
 * Đầu khu phải nằm TRONG hộp có đệm cùng thân: để mỗi màn tự ghép thì /devices đặt đầu khu
 * ngoài hộp (dí sát mép trái ô) còn /software đặt trong — hai màn lệch nhau (Q-20). Bảng bên
 * trong dùng kiểu bảng con `table.table.table-sub`.
 */
export function ExpandPanel({
  children,
  ...header
}: ComponentProps<typeof ExpandHeader> & { children: ReactNode }) {
  return (
    <div className="exp-panel">
      <ExpandHeader {...header} />
      {children}
    </div>
  );
}
