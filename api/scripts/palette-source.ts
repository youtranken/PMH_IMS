/**
 * Bảng màu của server (thư, file xuất bản vẽ) ← `web/src/css/tokens.css`, nguồn màu duy nhất
 * (AD-15). Hàm THUẦN: `scripts/gen-palette.ts` gọi nó để ghi `palette.generated.ts`, và
 * `palette.spec.ts` gọi lại để bắt tệp sinh ra bị lệch khỏi tokens.css.
 *
 * Chỉ đọc khối `:root` (bản SÁNG): thư và giấy in luôn nền sáng, không theo theme người dùng.
 */

/** Tên màu phía server → token CSS. Thêm màu = thêm token vào tokens.css trước, rồi thêm ở đây. */
export const PALETTE_TOKENS = {
  surface: '--surface',
  canvas: '--canvas',
  ink: '--ink',
  ink2: '--ink-2',
  muted: '--muted',
  border: '--border',
  primary: '--primary',
  onAccent: '--on-accent',
  warn: '--warn',
  danger: '--danger',
  info: '--info',
  paperRule: '--paper-rule',
  paperDraft: '--paper-draft',
  paperSuperseded: '--paper-superseded',
  paperPresentation: '--paper-presentation',
  diagramIconFill: '--diagram-icon-fill',
  diagramIconStroke: '--diagram-icon-stroke',
} as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** `--tên → giá trị` của khối `:root` đầu tiên (bỏ chú thích; khai trùng thì bản đầu thắng). */
export function tokenValues(css: string): Map<string, string> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const start = text.indexOf(':root');
  const open = start < 0 ? -1 : text.indexOf('{', start);
  const close = open < 0 ? -1 : text.indexOf('}', open);
  const out = new Map<string, string>();
  if (close < 0) return out;
  for (const m of text.slice(open + 1, close).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    if (!out.has(m[1])) out.set(m[1], m[2].trim());
  }
  return out;
}

/** Nội dung `palette.generated.ts`. Token thiếu hay không phải `#rrggbb` thì ném — không sinh tệp hỏng. */
export function paletteModule(css: string): string {
  const values = tokenValues(css);
  const lines = Object.entries(PALETTE_TOKENS).map(([name, token]) => {
    const value = values.get(token);
    if (!value || !HEX.test(value)) throw new Error(`tokens.css thiếu ${token} dạng #rrggbb trong :root (đang là "${value ?? ''}").`);
    return `  ${name}: '${value.toLowerCase()}',`;
  });
  return [
    '// SINH TỰ ĐỘNG từ web/src/css/tokens.css bởi `npm --prefix api run gen:palette` — đừng sửa tay.',
    '// `palette.spec.ts` đỏ khi tệp này lệch khỏi tokens.css.',
    'export const PALETTE = {',
    ...lines,
    '} as const;',
    '',
  ].join('\n');
}
