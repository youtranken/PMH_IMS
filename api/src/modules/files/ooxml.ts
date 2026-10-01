import { inflateRawSync } from 'node:zlib';

/**
 * Nhận diện Word/Excel/PowerPoint dạng mới (docx/xlsx/pptx) theo NỘI DUNG gói (NFR-9, Q-18).
 *
 * Magic `PK\x03\x04` chỉ nói "đây là zip": docx, xlsm, jar, apk và một kho nén chở exe đều mở
 * đầu như nhau. Thứ phân biệt được là `[Content_Types].xml` — Office đọc chính file này để biết
 * gói là loại gì, nên kiểm theo nó là kiểm theo đúng cách Office sẽ mở file. Đuôi file chỉ còn
 * vai trò bắt khớp: docx thật đặt tên .xlsx vẫn bị từ chối, vì người tải về sẽ mở sai ứng dụng.
 *
 * Bản có macro (docm/xlsm/pptm) bị chặn theo loại nội dung khai trong gói, kể cả khi đổi đuôi
 * thành .docx/.xlsx/.pptx. Gói nào mang `vbaProject.bin` cũng bị chặn, dù khai loại gì.
 *
 * Gói không macro vẫn chạy được mã khi mở: mẫu .dotm kéo từ máy lạ (template injection qua
 * `attachedTemplate`), khung / OLE trỏ ra ngoài, và đối tượng OLE nhúng (`oleObject*.bin`). Các
 * thứ đó cũng bị chặn — xem `hasActiveContent`.
 *
 * Tự đọc thư mục trung tâm của zip thay vì kéo thư viện: chỉ cần danh sách tên và một mục nhỏ,
 * và mọi trần (số mục, dung lượng giải nén) nằm ngay ở đây — một gói độc không làm nổ RAM.
 */

const MAIN_TYPES: Record<string, { ext: string; mime: string }> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml': {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml': {
    ext: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml': {
    ext: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
};

// Loại nội dung nói lên macro: `...macroEnabled.main+xml` và `application/vnd.ms-office.vbaProject`.
const MACRO_TYPE = /macroEnabled|vbaProject/i;
const VBA_PART = /(^|\/)vbaProject\.bin$/i;
/** Đối tượng OLE nhúng: phần `.bin` trong `embeddings/`, hoặc khai loại oleObject. */
const OLE_PART = /(^|\/)embeddings\/[^/]+\.bin$/i;
const OLE_TYPE = /oleObject/i;
/**
 * Quan hệ kéo mã từ ngoài vào lúc mở. `hyperlink` External là link bình thường; biểu đồ nhúng
 * bảng Excel đi bằng quan hệ `package` NỘI BỘ — cả hai phải qua.
 */
const ACTIVE_EXTERNAL_REL = /\/(attachedTemplate|oleObject|frame|subDocument)$/i;
/** Mọi quan hệ OLE, kể cả nội bộ. */
const OLE_REL = /\/oleObject$/i;
/**
 * Mẫu nằm trên chính ổ đĩa người soạn (`file:///C:/…/Normal.dotm`) là thứ Word tự ghi vào mọi
 * tài liệu tạo từ mẫu riêng — không kéo gì qua mạng. Đích khác (http, `\\máy\share`,
 * `file://máy/…`) là kéo từ máy lạ.
 */
const LOCAL_FILE_TARGET = /^file:\/\/\/[a-z]:[\\/]/i;
/** Một tệp `.rels` thật chỉ vài KB. */
const MAX_RELS_BYTES = 1024 * 1024;

/** Một gói Office thật có vài trăm mục; hơn thế này là thứ khác, không đọc tiếp. */
const MAX_ENTRIES = 20_000;
/** `[Content_Types].xml` thật chỉ vài KB; trần giải nén chặn zip bomb. */
const MAX_CONTENT_TYPES_BYTES = 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

/** MIME của gói OOXML được nhận; `null` = không phải docx/xlsx/pptx sạch khớp đuôi. */
export function detectOoxml(buf: Buffer, lowerName: string): string | null {
  const entries = readCentralDirectory(buf);
  if (!entries) return null;
  if (entries.some((entry) => VBA_PART.test(entry.name) || OLE_PART.test(entry.name))) return null;

  const typesEntry = entries.find((entry) => entry.name === '[Content_Types].xml');
  if (!typesEntry) return null;
  const typesXml = readEntry(buf, typesEntry, MAX_CONTENT_TYPES_BYTES)?.toString('utf8');
  if (!typesXml || MACRO_TYPE.test(typesXml) || OLE_TYPE.test(typesXml)) return null;
  if (hasActiveContent(buf, entries)) return null;

  const mains = [...typesXml.matchAll(/<Override\b[^>]*>/g)]
    .map((match) => ({
      partName: attr(match[0], 'PartName'),
      contentType: attr(match[0], 'ContentType'),
    }))
    .filter((override) => override.contentType !== null && MAIN_TYPES[override.contentType]);
  // Gói khai hai phần chính (vừa Word vừa Excel) là gói dựng tay, không phải thứ Office xuất ra.
  if (mains.length !== 1 || !mains[0].partName) return null;

  const partName = mains[0].partName.replace(/^\//, '').toLowerCase();
  if (!entries.some((entry) => entry.name.toLowerCase() === partName)) return null;

  const spec = MAIN_TYPES[mains[0].contentType!];
  return lowerName.endsWith(spec.ext) ? spec.mime : null;
}

/**
 * Có quan hệ nào kéo mã vào lúc mở không. Đọc mọi `.rels` của gói; `.rels` không đọc được (mã
 * hoá, quá trần) thì coi như CÓ — không xem được là không cho qua.
 */
function hasActiveContent(buf: Buffer, entries: ZipEntry[]): boolean {
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.rels')) continue;
    const xml = readEntry(buf, entry, MAX_RELS_BYTES)?.toString('utf8');
    if (xml === undefined) return true;
    for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const type = attr(match[0], 'Type') ?? '';
      if (OLE_REL.test(type)) return true;
      if (attr(match[0], 'TargetMode')?.toLowerCase() !== 'external') continue;
      if (!ACTIVE_EXTERNAL_REL.test(type)) continue;
      if (!LOCAL_FILE_TARGET.test(attr(match[0], 'Target') ?? '')) return true;
    }
  }
  return false;
}

function attr(tag: string, name: string): string | null {
  const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return found ? (found[1] ?? found[2]) : null;
}

/** Đọc thư mục trung tâm; `null` với zip hỏng, cụt, zip64 hoặc quá nhiều mục. */
function readCentralDirectory(buf: Buffer): ZipEntry[] | null {
  if (buf.length < 22) return null;
  let eocd = -1;
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  // 0xFFFF / 0xFFFFFFFF = zip64. Không file Office nào dưới 25 MB cần tới nó.
  if (count === 0xffff || dirOffset === 0xffffffff || count > MAX_ENTRIES) return null;
  if (dirOffset + dirSize > eocd) return null;

  const entries: ZipEntry[] = [];
  let p = dirOffset;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== SIG_CENTRAL) return null;
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    if (p + 46 + nameLength > eocd) return null;
    entries.push({
      flags: buf.readUInt16LE(p + 8),
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      uncompressedSize: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42),
      name: buf.toString('utf8', p + 46, p + 46 + nameLength),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Nội dung một mục (stored hoặc deflate), có trần; `null` nếu mã hoá, hỏng hoặc quá trần. */
function readEntry(buf: Buffer, entry: ZipEntry, maxBytes: number): Buffer | null {
  if (entry.flags & 0x1) return null;
  if (entry.uncompressedSize > maxBytes) return null;
  const local = entry.localOffset;
  if (local + 30 > buf.length || buf.readUInt32LE(local) !== SIG_LOCAL) return null;
  // Độ dài tên/phụ lấy ở header CỤC BỘ: nó có thể khác bản trong thư mục trung tâm.
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) return null;
  const raw = buf.subarray(start, end);
  if (entry.method === 0) return raw.length <= maxBytes ? raw : null;
  if (entry.method !== 8) return null;
  try {
    return inflateRawSync(raw, { maxOutputLength: maxBytes });
  } catch {
    return null;
  }
}
