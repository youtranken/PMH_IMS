import type { ReactNode } from 'react';

/**
 * Hình nhỏ trên nút — đóng (✕), thêm (+), ba chấm (⋮), và ba dấu tròn trạng thái (! · i · ✓) — dùng
 * chung cho cả app (AD-15).
 *
 * Không viết KÝ TỰ: chúng theo phông và cỡ chữ nên ở 14px mảnh như dấu ngoặc, nằm theo đường
 * cơ sở của chữ nên lệch khỏi tâm ô bấm, và đứng cạnh `Chevron` SVG thì đọc ra hai hệ thống
 * khác nhau. Mũi tên thì dùng `Chevron` (`ui/chevron.tsx`), không có bản ở đây.
 *
 * Kích thước `1em` như `Chevron`: to nhỏ theo `font-size` của nút bọc ngoài. Luôn `aria-hidden`
 * — tên của nút nằm ở `aria-label` của nút, không ở hình.
 */
function Glyph({
  className,
  strokeWidth = 2.4,
  children,
}: {
  className?: string;
  strokeWidth?: number;
  children: ReactNode;
}) {
  return (
    <svg
      className={['glyph', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Glyph>
  );
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

/** Ba chấm DỌC (Q-18) — chấm tô đặc, nét `currentColor`. */
export function KebabIcon({ className }: { className?: string }) {
  return (
    <svg
      className={['glyph', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

/** Dấu trong vòng tròn trạng thái: `error` = "!", `info` = "i", `good` = "✓". */
export function ToneIcon({ tone, className }: { tone: 'error' | 'info' | 'good'; className?: string }) {
  if (tone === 'good') {
    return (
      <Glyph className={className} strokeWidth={3}>
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </Glyph>
    );
  }
  return (
    <Glyph className={className} strokeWidth={3}>
      {tone === 'error' ? <path d="M12 5v9M12 19h.01" /> : <path d="M12 5h.01M12 10v9" />}
    </Glyph>
  );
}
