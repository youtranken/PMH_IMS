/**
 * Khung email dùng chung (AD-15) — mọi email của IMS đi qua đây, không màn nào tự dựng HTML.
 * Màu inline vì email client không đọc CSS variable; giá trị lấy từ Sunset Grove.
 */
export interface MailBlock {
  title: string;
  intro: string;
  rows?: { label: string; value: string }[];
  ctaLabel?: string;
  ctaUrl?: string;
  /**
   * Nút tràn bề ngang, cao hơn — cho thư mà việc chính là BẤM NÚT trên điện thoại (duyệt
   * break-glass lúc 2 giờ sáng). Nút nhỏ giữa đoạn chữ là thứ ngón cái bấm trượt.
   */
  ctaWide?: boolean;
  footnote?: string;
}

const INK = '#1f231c';
const MUTED = '#5a615a';
const BORDER = '#e9eae2';
const PRIMARY = '#0e9f6e';
const CANVAS = '#f7f6f2';

export function renderMail(block: MailBlock): { html: string; text: string } {
  const rows = (block.rows ?? [])
    .map(
      (r) =>
        `<tr><td style="padding:6px 0;color:${MUTED};font-size:13px;width:38%">${escapeHtml(r.label)}</td>` +
        `<td style="padding:6px 0;color:${INK};font-size:14px;font-weight:600">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');

  const cta =
    block.ctaUrl && block.ctaLabel
      ? `<p style="margin:20px 0 0"><a href="${block.ctaUrl}" style="${
          block.ctaWide
            ? 'display:block;text-align:center;padding:14px 18px;'
            : 'display:inline-block;padding:10px 18px;'
        }` +
        `background:${PRIMARY};color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px">` +
        `${escapeHtml(block.ctaLabel)}</a></p>`
      : '';

  const html = `<!doctype html><html lang="vi"><body style="margin:0;background:${CANVAS};
    font-family:'Segoe UI',Roboto,Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0"
          style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:28px">
          <tr><td>
            <p style="margin:0 0 4px;color:${PRIMARY};font-size:12px;font-weight:700;letter-spacing:.08em">IMS · PMH</p>
            <h1 style="margin:0 0 12px;color:${INK};font-size:20px">${escapeHtml(block.title)}</h1>
            <p style="margin:0;color:${MUTED};font-size:14px;line-height:1.6">${escapeHtml(block.intro)}</p>
            ${rows ? `<table role="presentation" width="100%" style="margin-top:16px">${rows}</table>` : ''}
            ${cta}
            ${
              block.footnote
                ? `<p style="margin:20px 0 0;color:${MUTED};font-size:12px;line-height:1.5">${escapeHtml(block.footnote)}</p>`
                : ''
            }
          </td></tr>
        </table>
        <p style="margin:14px 0 0;color:${MUTED};font-size:11px">Email tự động từ hệ thống IMS — vui lòng không trả lời.</p>
      </td></tr>
    </table>
  </body></html>`;

  const textRows = (block.rows ?? []).map((r) => `- ${r.label}: ${r.value}`).join('\n');
  const text = [
    `IMS · PMH — ${block.title}`,
    '',
    block.intro,
    textRows,
    block.ctaUrl ? `\n${block.ctaLabel}: ${block.ctaUrl}` : '',
    block.footnote ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  return { html, text };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
