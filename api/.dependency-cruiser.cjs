/**
 * AD-2 — ranh giới module enforce bằng CI, không chỉ review.
 * Luật: module nghiệp vụ chỉ được gọi nhau qua `*.api.ts`; đồ thị phải acyclic;
 * tầng nền không import tầng nghiệp vụ.
 *
 * PHÂN CÔNG với eslint (đọc cùng lúc hai file này):
 *   - `eslint.config.mjs` + `ad2-boundary.js` canh **cửa module ↔ module** (phải qua
 *     `*.api.ts`/`*.module.ts`/`*.types.ts`), khớp trên chuỗi import như người ta gõ.
 *     Danh sách ngoại lệ hạ tầng nằm ở ĐÓ, một chỗ duy nhất — đừng chép sang đây.
 *   - File này canh những thứ eslint không thấy được: tính acyclic, thứ tự TẦNG
 *     (common → modules, nền → nghiệp vụ), và quyền sở hữu BẢNG (AD-3).
 *
 * Lưu ý cú pháp: trong chuỗi JS `'\.'` rơi mất dấu chéo và thành `.` (khớp ký tự bất kỳ).
 * Mọi regex dưới đây phải viết `\\.` — bản trước viết `\.` nên các luật rộng hơn ý định.
 */
const BIZ = 'devices|software|ipam|vault|service-accounts|sheets|incidents|documents|dashboard|disposal';
const BASE = 'auth|audit|approvals|outbox|queue|expiry|files|config-sys|catalog|users|mail';

module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Đồ thị phụ thuộc phải acyclic (AD-2).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'biz-cross-only-via-api',
      severity: 'error',
      comment:
        'Module nghiệp vụ chỉ được import *.api.ts của module nghiệp vụ khác (AD-2/AD-3). ' +
        'Cấm chạm service/schema nội bộ hoặc query bảng của module khác.',
      from: { path: `^src/modules/(${BIZ})/` },
      to: {
        path: `^src/modules/(${BIZ})/`,
        // `$1` = tên module ở vế `from` (group matching của dependency-cruiser):
        // import TRONG CÙNG module luôn hợp lệ, chỉ sang module KHÁC mới phải qua *.api.ts.
        // (Bản cũ viết '\1' — backreference của regex, không phải cú pháp group matching —
        //  nên luật bắt nhầm mọi import nội bộ ngay khi module nghiệp vụ đầu tiên ra đời.)
        pathNot: [
          `^src/modules/(${BIZ})/[^/]+\\.api\\.ts$`,
          // `*.module.ts` là cửa CHÍNH THỨC của một module trong Nest: nó chỉ export
          // đúng `*.api.ts`, nên import nó là cách duy nhất để DI cấp được api service.
          // Cấm cả dòng này thì hai module nghiệp vụ không bao giờ gọi nhau được — trái
          // với chính AD-2 ("gọi nhau QUA *.api.ts", tức là có gọi nhau).
          `^src/modules/(${BIZ})/[^/]+\\.module\\.ts$`,
          '^src/modules/$1/',
        ],
      },
    },
    {
      name: 'base-must-not-import-biz',
      severity: 'error',
      comment: 'Tầng nền không được biết tầng nghiệp vụ (AD-2).',
      from: { path: `^src/modules/(${BASE})/` },
      to: { path: `^src/modules/(${BIZ})/` },
    },
    {
      name: 'common-must-not-import-modules',
      severity: 'error',
      comment: 'src/common là hạ tầng thuần — không import module nghiệp vụ.',
      from: { path: '^src/common/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/[^/]+/types\\.ts$' },
    },
    {
      name: 'secret-table-only-in-vault',
      severity: 'error',
      comment: 'AD-4: schema két sắt chỉ được dùng trong module vault.',
      from: { pathNot: '^src/modules/vault/' },
      to: { path: '^src/modules/vault/.*\\.schema\\.ts$' },
    },
    {
      name: 'schema-only-in-owning-module',
      severity: 'error',
      comment:
        'AD-3 — mỗi bảng một chủ: chỉ module sở hữu mới được import `*.schema.ts` của chính nó. ' +
        'Module khác đọc/ghi qua `*.api.ts`. (Ngoại lệ auth↔users khai ở vế FROM bên dưới: hai ' +
        'module này là MỘT chủ của bảng `users` theo spine.)',
      /*
       * NGOẠI LỆ auth↔users khai ở vế `from`, KHÔNG ở vế `to` (rà soát 07/09 #9, vá 08/09).
       *
       * Bản trước để `'^src/modules/users/users\\.schema\\.ts$'` trong `to.pathNot` mà không
       * ràng buộc `from` — nghĩa là MỌI module đều import được bảng `users`, không riêng `auth`.
       * Ghép với lỗ `../../modules/` của cổng eslint (vá cùng ngày) thì
       * `import { usersTable } from '../../modules/users/users.schema'` qua sạch CẢ HAI cổng:
       * đường ngắn nhất phá AD-3.
       *
       * Nay chỉ đúng hai file của `auth` được miễn, và chúng được miễn vì lý do có thật:
       * `sessions.schema` và `known-device.schema` khai khóa ngoại trỏ sang `usersTable`.
       *
       * Có ngày tách hẳn hai module thì xóa khối này TRƯỚC, rồi mới sửa code.
       */
      from: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          '^src/modules/auth/sessions\\.schema\\.ts$',
          '^src/modules/auth/known-device\\.schema\\.ts$',
        ],
      },
      to: {
        path: '^src/modules/([^/]+)/[^/]+\\.schema\\.ts$',
        pathNot: ['^src/modules/$1/'],
      },
    },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: '\\.d\\.ts$' }, to: {} },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\\.spec\\.ts$' },
    reporterOptions: { dot: { collapsePattern: 'src/modules/[^/]+' } },
  },
};
