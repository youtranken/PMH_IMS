/**
 * ===== Ranh giới tầng của web, ép trên ĐƯỜNG DẪN ĐÃ RESOLVE =====
 *
 * Vì sao cần cả file này khi `eslint.config.mjs` đã có `no-restricted-imports`: eslint khớp
 * trên CHUỖI import như người ta gõ, còn dependency-cruiser khớp sau khi đã giải alias và
 * đường dẫn tương đối. Rà soát 07/09 chỉ ra đúng lỗ đó ở phía api — luật regex AD-2 bắt
 * `'../users/users.service'` nhưng để lọt `'../../modules/users/users.service'`, cùng một file.
 * Ở đây `@/features/x`, `../features/x`, `../../features/x` đều resolve về `src/features/x`
 * nên chỉ cần MỘT luật, không có cách gõ nào lách được.
 *
 * Trước 07/09 web KHÔNG có file này — nghĩa là vòng lặp phụ thuộc bên web chưa từng có ai canh.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Vòng phụ thuộc. api giữ được đồ thị acyclic thật (0 forwardRef) suốt 9 epic; web cũng phải vậy.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'File không ai import và không import ai — thường là code chết. Rà soát 07/09 tìm thấy ui/photo-lightbox.tsx đúng dạng này.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)vite-env\\.d\\.ts$', '(^|/)main\\.tsx$'] },
      to: {},
    },
    {
      name: 'base-must-not-import-features',
      severity: 'error',
      comment:
        'AD-15: tầng nền (ui/lib/shell/css) KHÔNG được biết tới features. Chiều phụ thuộc chỉ đi một hướng: features -> ui/lib/shell. Cần dữ liệu của feature thì nhận qua prop.',
      from: { path: '^src/(ui|lib|shell)/' },
      to: { path: '^src/features/' },
    },
    {
      name: 'feature-cross-only-via-shared',
      severity: 'error',
      comment:
        'AD-15: một feature KHÔNG import ruột feature khác. Thứ dùng ở >=2 màn là tài sản dùng chung -> web/src/ui hoặc web/src/lib, và phải khai vào docs/SHARED-REGISTRY.md.',
      from: { path: '^src/features/([^/]+)/' },
      to: {
        path: '^src/features/([^/]+)/',
        pathNot: [
          // Cùng một feature thì tự do.
          '^src/features/$1/',
          /*
           * Ba ngoại lệ TƯỜNG MINH, giống hệt danh sách trong `eslint.config.mjs`. Hai chỗ
           * phải khớp nhau; lệch là một trong hai cổng nói dối. Thêm một dòng ở đây là phải
           * thêm cả bên kia, tức phải giải thích trong PR.
           */
          '^src/features/software/device-licenses-expand',
          '^src/features/catalog/catalog-form',
          '^src/features/devices/device-form',
        ],
      },
    },
    {
      name: 'no-dialog-in-features',
      severity: 'error',
      comment:
        'AD-15: không tự dựng dialog/portal trong features/. Dùng Dialog (Radix) của web/src/ui.',
      from: { path: '^src/features/' },
      to: { path: '^node_modules/react-dom($|/)', pathNot: ['react-dom/client'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(test|spec)\\.(ts|tsx)$' },
    tsConfig: { fileName: 'tsconfig.app.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
