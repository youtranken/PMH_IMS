import type { ReactNode } from 'react';

/**
 * Danh sách bước đánh số cho màn trống / hộp hướng dẫn ("làm 1 → 2 → 3 là xong"). `<ol>` thật nên
 * trình đọc màn hình đọc được "danh sách 4 mục"; số vẽ bằng CSS counter (`.step-list`) để nó không
 * lọt vào chữ của từng bước.
 */
export function StepList({ label, steps }: { label: string; steps: ReactNode[] }) {
  return (
    <ol className="step-list" aria-label={label}>
      {steps.map((step, index) => (
        <li key={index}>{step}</li>
      ))}
    </ol>
  );
}
