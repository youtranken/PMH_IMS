import type { ReactNode } from 'react';

/**
 * Hình nhỏ trên nút — đóng (✕), ba chấm (⋮), ba dấu tròn trạng thái (! · i · ✓) và ba biểu
 * tượng giao diện (sáng · tối · theo hệ thống) — dùng chung cho cả app (AD-15).
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

/*
 * Ba biểu tượng giao diện sáng / tối / theo hệ thống — MỘT bộ cho nút ở topbar (`ThemeSwitch`),
 * menu tài khoản và màn Hồ sơ (`ThemeChoice`): người dùng nhận ra cùng một lựa chọn ở cả ba chỗ.
 * Nét 2 thay vì 2,4: hình nhiều chi tiết, nét dày thì tia mặt trời dính vào nhau ở cỡ 16px.
 */
export function SunIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className} strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Glyph>
  );
}

export function MoonIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className} strokeWidth={2}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </Glyph>
  );
}

/** "Theo hệ thống": màn hình máy tính — giao diện theo cài đặt của máy. */
export function MonitorIcon({ className }: { className?: string }) {
  return (
    <Glyph className={className} strokeWidth={2}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Glyph>
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
