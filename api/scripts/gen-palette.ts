/**
 * Sinh `src/common/palette.generated.ts` từ `web/src/css/tokens.css`:
 *
 *   npm --prefix api run gen:palette
 *
 * Chạy sau mỗi lần đổi một token mà server dùng (danh sách ở `scripts/palette-source.ts`).
 * Image api không chứa web/, nên server không đọc CSS lúc chạy — tệp sinh ra được commit, và
 * `palette.spec.ts` đỏ nếu nó lệch.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paletteModule } from './palette-source';

const css = readFileSync(resolve(__dirname, '../../web/src/css/tokens.css'), 'utf8');
writeFileSync(resolve(__dirname, '../src/common/palette.generated.ts'), paletteModule(css));
