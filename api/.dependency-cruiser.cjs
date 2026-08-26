/**
 * AD-2 — ranh giới module enforce bằng CI, không chỉ review.
 * Luật: module nghiệp vụ chỉ được gọi nhau qua `*.api.ts`; đồ thị phải acyclic;
 * tầng nền không import tầng nghiệp vụ.
 */
const BIZ = 'devices|software|ipam|vault|service-accounts|sheets|incidents|documents|dashboard';
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
          `^src/modules/(${BIZ})/[^/]+\.api\.ts$`,
          // `*.module.ts` là cửa CHÍNH THỨC của một module trong Nest: nó chỉ export
          // đúng `*.api.ts`, nên import nó là cách duy nhất để DI cấp được api service.
          // Cấm cả dòng này thì hai module nghiệp vụ không bao giờ gọi nhau được — trái
          // với chính AD-2 ("gọi nhau QUA *.api.ts", tức là có gọi nhau).
          `^src/modules/(${BIZ})/[^/]+\.module\.ts$`,
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
      to: { path: '^src/modules/', pathNot: '^src/modules/[^/]+/types\.ts$' },
    },
    {
      name: 'secret-table-only-in-vault',
      severity: 'error',
      comment: 'AD-4: schema két sắt chỉ được dùng trong module vault.',
      from: { pathNot: '^src/modules/vault/' },
      to: { path: '^src/modules/vault/.*\.schema\.ts$' },
    },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: '\.d\.ts$' }, to: {} },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    exclude: { path: '\.spec\.ts$' },
    reporterOptions: { dot: { collapsePattern: 'src/modules/[^/]+' } },
  },
};
