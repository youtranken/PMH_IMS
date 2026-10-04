import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../common/tx';
import type { Database } from '../../database/database.module';

/**
 * Ảnh nhúng của bản vẽ lưu MỘT lần (Q-23, migration 0057). Phần thuần (tách / ghép) test bảng dữ
 * liệu ở `diagram-images.spec.ts`; phần DB ở cuối file.
 *
 * Phiên bản lưu `ims-img:<dạng>:<sha>` thay cho `data:<mime>[;base64],<base64>`. `dạng` = `b` khi
 * bản gốc có `;base64`, `n` khi không (draw.io bỏ nó trong chuỗi style vì `;` là dấu tách khoá) —
 * nhờ vậy ghép lại ra ĐÚNG từng byte của bản đã gửi lên, kể cả trong nhãn HTML đã thoát thực thể:
 * chỉ thay chuỗi con đã khớp, không đọc lại XML.
 */

export const IMAGE_REF_PREFIX = 'ims-img:';

/**
 * Ảnh nhỏ hơn thế để nguyên trong XML: một hàng + một tham chiếu tốn hơn chính ảnh. Đây là ngưỡng
 * kỹ thuật của cách lưu, không phải tham số nghiệp vụ.
 */
export const IMAGE_MIN_BYTES = 512;

/** Khớp cột `diagram_image.byte_size` (0057). Lớn hơn thì để nguyên — trần XML/SVG vẫn chặn. */
export const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/*
 * `data:image/<mime>[;base64],<base64>` mà NGAY SAU phần base64 không còn ký tự nào có thể thuộc nó
 * (kể cả `%` của chuỗi mã hoá URL) — không tách nửa vời một chuỗi bị cắt.
 */
const DATA_IMAGE_RE = /data:(image\/[A-Za-z0-9.+-]{1,60})(;base64)?,([A-Za-z0-9+/]+={0,2})(?![A-Za-z0-9+/=%])/g;
const REF_RE = /ims-img:([bn]):([0-9a-f]{64})/g;

export interface ExtractedImage {
  mime: string;
  bytes: Buffer;
}

export interface StoredImage {
  mime: string;
  base64: string;
}

export interface DriedText {
  text: string;
  /** Ảnh MỚI tách ra ở lượt này, theo sha. */
  images: Map<string, ExtractedImage>;
  /** Mọi sha văn bản khô đang trỏ tới (cả tham chiếu có sẵn — bản sao, khôi phục). */
  refs: Set<string>;
}

export function imageSha(mime: string, bytes: Buffer): string {
  return createHash('sha256').update(`${mime}\n`).update(bytes).digest('hex');
}

/** Tách ảnh nhúng ra khỏi XML/SVG. Văn bản đã khô đi qua không đổi (chỉ thu tham chiếu). */
export function dryImages(text: string): DriedText {
  const images = new Map<string, ExtractedImage>();
  const out = text.replace(DATA_IMAGE_RE, (whole, mime: string, flag: string | undefined, payload: string) => {
    const bytes = Buffer.from(payload, 'base64');
    // Chỉ base64 chuẩn: ghép lại từ byte phải ra đúng chuỗi cũ, nếu không thì để nguyên.
    if (bytes.length < IMAGE_MIN_BYTES || bytes.length > IMAGE_MAX_BYTES || bytes.toString('base64') !== payload) return whole;
    const sha = imageSha(mime, bytes);
    if (!images.has(sha)) images.set(sha, { mime, bytes });
    return `${IMAGE_REF_PREFIX}${flag ? 'b' : 'n'}:${sha}`;
  });
  return { text: out, images, refs: imageRefs(out) };
}

export function imageRefs(text: string): Set<string> {
  const refs = new Set<string>();
  for (const match of text.matchAll(REF_RE)) refs.add(match[2]);
  return refs;
}

/** Ghép ảnh trở lại thành `data:` URI. Tham chiếu không có trong `images` để nguyên, báo `missing`. */
export function hydrateImages(text: string, images: Map<string, StoredImage>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(REF_RE, (whole, form: string, sha: string) => {
    const image = images.get(sha);
    if (!image) {
      missing.add(sha);
      return whole;
    }
    return `data:${image.mime}${form === 'b' ? ';base64' : ''},${image.base64}`;
  });
  return { text: out, missing: [...missing] };
}

/**
 * Chuỗi dành riêng trong XML/SVG người dùng gửi lên: để lọt thì lần mở sau nó bị ghép thành ảnh
 * (có thể là ảnh của bản vẽ khác, nếu đoán được sha). Lưu từ web thì từ chối.
 */
export function hasReservedImageRef(text: string): boolean {
  return text.toLowerCase().includes(IMAGE_REF_PREFIX);
}

/* ---------------------------------------------------------------- DB ----- */

/*
 * Khoá tư vấn giữa "lưu có ảnh" (chia sẻ) và "dọn ảnh mồ côi" (độc quyền): lượt dọn không xoá được
 * một ảnh mà một lượt lưu chưa commit vừa tính là "đã có" (INSERT … DO NOTHING không khoá hàng).
 * Lấy SAU khoá hàng `diagram` ở cả hai phía để không đảo thứ tự khoá.
 */
const IMAGE_LOCK_KEY = 727101;

/**
 * Lưu ảnh mới (trùng thì thôi) + nối phiên bản với mọi ảnh nó dùng, trong `tx` của lượt lưu phiên bản.
 */
export async function linkImagesWithin(tx: Tx, versionId: string, actor: string, dried: { images: Map<string, ExtractedImage>; refs: Set<string> }): Promise<void> {
  if (dried.refs.size === 0) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${IMAGE_LOCK_KEY})`);
  for (const [sha, image] of dried.images) {
    await tx.execute(sql`
      INSERT INTO diagram_image (sha, mime, data, byte_size, created_by)
      VALUES (${sha}, ${image.mime}, ${image.bytes}, ${image.bytes.length}, ${actor})
      ON CONFLICT (sha) DO NOTHING
    `);
  }
  const shas = [...dried.refs];
  await tx.execute(sql`
    INSERT INTO diagram_version_image (version_id, sha)
    SELECT ${versionId}::uuid, unnest(${`{${shas.join(',')}}`}::text[])
    ON CONFLICT DO NOTHING
  `);
}

/** Ảnh theo sha cho một lượt ghép (một câu cho mọi văn bản của lượt đọc). */
export async function loadImages(db: Database | Tx, texts: (string | null)[]): Promise<Map<string, StoredImage>> {
  const shas = new Set<string>();
  for (const text of texts) if (text) for (const sha of imageRefs(text)) shas.add(sha);
  if (shas.size === 0) return new Map();
  const { rows } = await db.execute<{ sha: string; mime: string; data: Buffer }>(
    sql`SELECT sha, mime, data FROM diagram_image WHERE sha = ANY (${`{${[...shas].join(',')}}`}::text[])`,
  );
  return new Map(rows.map((r) => [r.sha, { mime: r.mime, base64: Buffer.from(r.data).toString('base64') }]));
}

/** Ghép ảnh cho nhiều văn bản một lượt; `null` đi qua nguyên. */
export async function hydrateTexts<T extends (string | null)[]>(db: Database | Tx, texts: [...T]): Promise<T> {
  const images = await loadImages(db, texts);
  if (images.size === 0) return texts;
  return texts.map((text) => (text === null ? null : hydrateImages(text, images).text)) as T;
}

/**
 * Xoá ảnh không còn phiên bản nào dùng — cuối transaction Bỏ bản nháp / Xoá hẳn, sau khi hàng nối
 * của các phiên bản bị xoá đã đi theo khoá ngoại.
 */
export async function collectUnusedImagesWithin(tx: Tx): Promise<number> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${IMAGE_LOCK_KEY})`);
  const { rows } = await tx.execute<{ n: number }>(sql`
    WITH gone AS (
      DELETE FROM diagram_image i
       WHERE NOT EXISTS (SELECT 1 FROM diagram_version_image l WHERE l.sha = i.sha)
      RETURNING 1
    ) SELECT count(*)::int AS n FROM gone
  `);
  return Number(rows[0]?.n ?? 0);
}
