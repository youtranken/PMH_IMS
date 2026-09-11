import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * CỬA CANH RÁC — hàng do bài kiểm tạo ra mà lượt dọn KHÔNG dọn được.
 *
 * ===== VÌ SAO CẦN MỘT CỔNG RIÊNG =====
 *
 * `api/scripts/reset-e2e.mjs` dọn theo QUY ƯỚC ĐẶT TÊN (`device.code ILIKE '%E2E%'`,
 * `users.email LIKE 'e2e-tao-moi-%'`, …). Nhanh và đơn giản, nhưng có một điều kiện ngầm:
 * bài kiểm phải đặt tên đúng quy ước. Đặt sai thì hàng đó không thuộc về ai — không lượt dọn
 * nào xoá, và KHÔNG CÓ GÌ ĐỎ.
 *
 * Rác không tự báo, và cái giá của nó không nằm ở chỗ nó chiếm dung lượng. Nó làm đỏ một bài
 * kiểm Ở CHỖ KHÁC, sau nhiều ngày, với thông điệp không nhắc gì tới nguyên nhân:
 *
 *   · 09/09 — `subnet`/`software`: 27 dải và 11 hồ sơ phần mềm tích lại vì hai spec đặt tên
 *     thiếu chữ "E2E"; 8 bài đỏ trông y như một hồi quy của API.
 *   · 11/09 — `users`: `leo-thang-quyen.spec.ts` tạo tài khoản tên `sau-ma-…`, `nan-nhan-…`,
 *     `tam-…`. Hai ngày sau bảng có 31 hàng, và bài "SA tạo tài khoản mới" đỏ vì hàng vừa tạo
 *     bị đẩy khỏi TRANG 1 (danh sách sắp theo tên, `limit=20`). Lỗi báo "không thấy email" —
 *     không một chữ nào về phân trang, và tuyệt nhiên không nhắc tới file spec gây ra.
 *
 * ===== VÌ SAO BẢN 11/09 ĐỔI HẲN CÁCH HỎI =====
 *
 * Bản trước giữ một danh sách `WATCHED` gõ tay — bốn bảng, kèm một vị từ `NOT ILIKE '%E2E%'`
 * CHÉP LẠI từ lượt dọn. Hai khuyết tật, và cả hai đều đã cắn:
 *
 *   1. MẶC ĐỊNH MỞ. Bảng không có tên trong danh sách thì vô hình — đúng cách `users` đứng
 *      ngoài suốt, và đúng cách bảng thứ năm sẽ đứng ngoài vào năm sau.
 *   2. HAI BẢN LUẬT. Lượt dọn xoá theo `LIKE 'e2e-tao-moi-%'`, cửa canh báo theo
 *      `NOT ILIKE '%E2E%'`. Một email kiểu `kiem-tra-e2e@…` lọt cửa canh mà vẫn không bị xoá.
 *
 * Bản này không hỏi "tên có đúng quy ước không" nữa. Nó CHẠY TRỌN LƯỢT DỌN rồi hỏi "còn sót
 * gì không". Thứ sống sót qua lượt dọn thì theo ĐỊNH NGHĨA là thứ lượt dọn không dọn được —
 * không phải đoán, không phải chép luật ra chỗ thứ hai, và không cần ai nhớ khai bảng mới.
 *
 * Bảng con dọn theo khoá ngoại (`ip_address`, `device_port`, `*_history`…) cũng được phủ
 * miễn phí: chúng biến mất cùng hàng gốc, nên chỉ sót khi hàng gốc sai tên — và lúc đó chính
 * hàng gốc hiện ra trong báo cáo.
 */

export const RUN_START_FILE = fileURLToPath(new URL('.e2e-run-start', import.meta.url));

const COMPOSE = 'docker compose -f docker-compose.yml -f docker-compose.override.e2e.yml';

/**
 * Bảng ĐƯỢC PHÉP giữ lại hàng sau lượt dọn. Mỗi dòng là một NGOẠI LỆ VIẾT RA GIẤY.
 *
 * Đây là nửa còn lại của "mặc định đóng": mọi bảng khác có `created_at` đều bị canh, kể cả
 * bảng chưa ai nghĩ tới. Thêm tên vào đây là một quyết định phải giải thích được trong PR,
 * không phải một chỗ để dập tắt cảnh báo.
 */
const MAY_GROW: Record<string, string> = {
  audit_log:
    'AD-13/NFR-03: chỉ-thêm, giữ vĩnh viễn. Trigger `audit_log_no_delete` chặn cả DELETE lẫn TRUNCATE — dọn được nó mới là lỗi.',
  outbox:
    'Sổ sự kiện đã phát; giữ lại để truy vết đường mail. Không gắn với hồ sơ nghiệp vụ nào nên không có gốc để dọn theo.',
  sessions:
    'Lượt dọn THU HỒI phiên (`revoked_at`) chứ không xoá — dấu vết "ai đăng nhập lúc nào" là thứ NFR-01 cần giữ.',
};

/**
 * Bảng KHÔNG có `created_at` — cửa canh không nhìn thấy chúng, và đó là điểm mù DUY NHẤT còn lại.
 *
 * Không có cột đó thì không trả lời được câu "hàng này sinh ra trong lượt chạy nào", nên không
 * có cách nào phân biệt rác của bài kiểm với dữ liệu có sẵn.
 *
 * Đo ngày 11/09, sau một lượt chạy đầy đủ: cả năm bảng SẠCH. Hai bảng đầu là hạ tầng, ba bảng
 * sau đều có đường dọn riêng và không sót hàng nào. Nên KHÔNG dựng thêm cơ chế chụp-số-đếm cho
 * một vấn đề chưa xảy ra — thứ đáng canh không phải năm bảng này, mà là bảng thứ SÁU.
 *
 * Danh sách này chính là chỗ canh điều đó: bảng mới nào ra đời mà thiếu `created_at` sẽ làm
 * lượt E2E đỏ NGAY, kèm câu hỏi phải trả lời — thay vì lặng lẽ mở rộng điểm mù.
 */
const NO_CREATED_AT: Record<string, string> = {
  _migrations: 'Sổ migration của chính runner — không phải dữ liệu nghiệp vụ.',
  system_config: 'Bảng cấu hình, 17 hàng cố định. Lượt dọn chỉ SỬA giá trị, không thêm hàng.',
  known_device:
    'Dọn theo `user_id` trong vùng `users`. Đo 11/09: chỉ còn 3 hàng của `sa@pmh.com.vn` thật.',
  license_assignment:
    'Dọn theo khoá ngoại trong cả vùng `devices` lẫn `software`. Đo 11/09: còn 1 hàng của dữ liệu thật.',
  login_failure:
    'Dọn theo `user_id` trong vùng `users`, và có sweeper tự dọn hàng nguội. Đo 11/09: 0 hàng.',
};

export function markRunStart(): void {
  writeFileSync(RUN_START_FILE, new Date().toISOString(), 'utf8');
}

/**
 * Bảng mới nào vừa mở rộng điểm mù — tức không có `created_at` và cũng chưa ai khai lý do.
 *
 * Trả về danh sách tên, rỗng là ổn. Đây là nửa "mặc định đóng" của chính cửa canh: nó không
 * tự nhận là nhìn thấy mọi thứ, nhưng nó BIẾT chỗ nó không nhìn thấy, và kêu khi chỗ đó rộng ra.
 */
function newBlindSpots(): string[] {
  const known = Object.keys(NO_CREATED_AT)
    .map((t) => `'${t}'`)
    .join(', ');
  return psql(
    `SELECT t.table_name FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT IN (${known})
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                         WHERE c.table_schema = 'public' AND c.table_name = t.table_name
                           AND c.column_name = 'created_at')
      ORDER BY t.table_name`,
  );
}

/**
 * Chạy trọn lượt dọn rồi trả về mô tả những hàng CÒN SÓT, hoặc chuỗi rỗng nếu sạch.
 *
 * KHÔNG ném ở đây: nơi gọi quyết định làm gì. Bản thân việc truy vấn hỏng (docker chưa lên,
 * psql trượt) cũng không được làm cả lượt chạy đỏ — cửa này canh RÁC, và một lượt E2E xanh
 * không đáng bị lật vì `docker exec` chớp một cái.
 */
export function findLeakedRows(): string {
  if (!existsSync(RUN_START_FILE)) return '';
  const since = readFileSync(RUN_START_FILE, 'utf8').trim();
  if (!since) return '';

  try {
    // Bước 1: dọn hết. Lượt cuối của bộ E2E không có `beforeEach` nào chạy sau nó, nên nếu
    // không dọn ở đây thì dữ liệu HỢP LỆ của bài cuối cũng bị đếm là rác.
    execSync(`${COMPOSE} exec -T -e ALLOW_E2E_RESET=1 api node scripts/reset-e2e.mjs all`, {
      cwd: '..',
      stdio: 'pipe',
    });
  } catch (error) {
    // Dọn hỏng thì KHÔNG kết luận gì — báo để người đọc biết cửa canh không chạy được.
    console.error('[e2e] cửa canh rác: không chạy được lượt dọn cuối, bỏ qua lượt kiểm.', error);
    return '';
  }

  try {
    const parts: string[] = [];
    const blind = newBlindSpots();
    if (blind.length > 0) {
      parts.push(
        `  [ĐIỂM MÙ MỚI] bảng không có \`created_at\`, cửa canh không nhìn được: ${blind.join(', ')}`,
      );
    }
    for (const { table, column } of survivorsSince(since)) {
      const rows = psql(
        `SELECT ${column} FROM ${table} WHERE created_at > '${since}'::timestamptz ` +
          `ORDER BY created_at LIMIT 5`,
      );
      if (rows.length > 0) parts.push(`  ${table}.${column}: ${rows.join(', ')}`);
    }
    return parts.join('\n');
  } catch (error) {
    // Hỏi DB mà hỏng thì KHÔNG kết luận gì — cửa này canh rác, nó không phải một bài kiểm.
    console.error('[e2e] cửa canh rác: không hỏi được DB, bỏ qua lượt kiểm.', error);
    return '';
  }
}

/**
 * Bảng nào còn hàng tạo ra sau `since`, và cột nào của nó đáng in ra cho người đọc.
 *
 * Duyệt `information_schema` chứ không gõ tay danh sách bảng — đó chính là chỗ bản trước để
 * lọt `users`. Chỉ xét bảng có `created_at`: không có cột đó thì không trả lời được câu "hàng
 * này sinh ra trong lượt chạy nào".
 */
function survivorsSince(since: string): { table: string; column: string }[] {
  const skipped = Object.keys(MAY_GROW)
    .map((t) => `'${t}'`)
    .join(', ');

  /*
   * Cột để in: ưu tiên thứ NGƯỜI ĐỌC nhận ra ngay. `id` là phương án cuối — một dòng uuid
   * không nói được spec nào đã tạo ra nó, mà đó mới là thứ người đọc cần.
   */
  const rows = psql(
    `SELECT c.table_name || '|' || coalesce(max(c.column_name) FILTER (WHERE c.column_name = 'code'),
                     max(c.column_name) FILTER (WHERE c.column_name = 'name'),
                     max(c.column_name) FILTER (WHERE c.column_name = 'email'),
                     max(c.column_name) FILTER (WHERE c.column_name = 'label'),
                     'id')
       FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name IN (SELECT table_name FROM information_schema.columns
                              WHERE table_schema = 'public' AND column_name = 'created_at')
        AND c.table_name NOT IN (${skipped})
      GROUP BY c.table_name
      ORDER BY c.table_name`,
  );

  const out: { table: string; column: string }[] = [];
  for (const row of rows) {
    const [table, column] = row.split('|');
    if (!table) continue;
    const left = psql(
      `SELECT count(*) FROM ${table} WHERE created_at > '${since}'::timestamptz`,
    );
    if (Number(left[0] ?? 0) > 0) out.push({ table, column: column || 'id' });
  }
  return out;
}

/**
 * Một câu psql. MỘT DÒNG và không dùng `-F'|'`.
 *
 * `execSync` trên Windows đi qua `cmd.exe`: chuỗi nhiều dòng làm cụt câu lệnh, còn `'|'` thì
 * cmd đọc dấu nháy đơn như ký tự thường rồi vấp vào `|` như một pipe. Nên ghép cột bằng `||`
 * ngay trong SQL và giữ câu lệnh trên một dòng. Cùng cái bẫy đã ghi ở `helpers.ts.sql()`.
 */
function psql(sql: string): string[] {
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  const out = execSync(`${COMPOSE} exec -T postgres psql -U ims -d ims -tAc "${oneLine}"`, {
    cwd: '..',
    stdio: 'pipe',
  }).toString();
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function clearRunStart(): void {
  rmSync(RUN_START_FILE, { force: true });
}
