import { lint, printConfig, withProbe } from '../test/lint-probe';

/**
 * Bài kiểm cho CHÍNH CỔNG AD-2 — chạy eslint thật, không đọc regex bằng mắt.
 *
 * `ad2-boundary.spec.ts` kiểm BIỂU THỨC. File này kiểm CỔNG: biểu thức đúng vẫn có thể không
 * chặn được gì, nếu khối `files:` gắn nhầm chỗ hoặc một khối `'off'` phía dưới tắt mất nó.
 * Có hai lỗi thuộc loại đó — (a) import viết kiểu "dài" đi vòng qua biểu thức, (b) ở dưới —
 * và cả hai đều vô hình với bài kiểm regex.
 *
 * ===== FINDING (b): `'off'` TẮT CẢ AD-2, KHÔNG CHỈ LUẬT THƯ VIỆN =====
 *
 * `eslint.config.mjs` có một khối "Nơi DUY NHẤT được phép chạm nguyên thủy tương ứng" đặt
 * `'no-restricted-imports': 'off'` cho bốn đường dẫn. Ý định là cho `mail-transport.service`
 * import `nodemailer` và `password.service` import `@node-rs/argon2`.
 *
 * Nhưng `no-restricted-imports` chở CẢ HAI thứ: danh sách thư viện cấm VÀ biểu thức AD-2.
 * Tắt nó đi là tắt luôn AD-2 — và hai trong bốn đường dẫn đó nằm trong `src/modules/`, đúng
 * nơi AD-2 có hiệu lực. Kết quả: `password.service.ts` (lõi bảo mật) và `mail-transport.
 * service.ts` được phép import thẳng ruột của mọi module khác, vĩnh viễn, không ai thấy.
 *
 * Cùng khuôn với luật `appendBestEffort`: ngoại lệ phải khai lại
 * luật mà BỚT đúng một mục, không được `'off'` cả cụm.
 */

const API_ROOT_MODULES = 'src/modules';

/** Import xuyên ruột module khác, viết theo kiểu "dài" — đúng đường vòng của finding (a). */
const CROSS_LONG = `import { VaultService } from '../../modules/vault/vault.service';
export type Probe = VaultService;
`;

/** Cùng file đó, viết kiểu ngắn. */
const CROSS_SHORT = `import { VaultService } from '../vault/vault.service';
export type Probe = VaultService;
`;

describe('cổng AD-2 chạy thật', () => {
  it('viết NGẮN (../vault/vault.service) → chặn', () => {
    withProbe(`${API_ROOT_MODULES}/devices/probe-ad2-short.ts`, CROSS_SHORT, () => {
      expect(lint(`${API_ROOT_MODULES}/devices/probe-ad2-short.ts`)).toContain(
        'no-restricted-imports',
      );
    });
  });

  it('viết DÀI (../../modules/vault/vault.service) → cũng chặn (finding #9a)', () => {
    withProbe(`${API_ROOT_MODULES}/devices/probe-ad2-long.ts`, CROSS_LONG, () => {
      expect(lint(`${API_ROOT_MODULES}/devices/probe-ad2-long.ts`)).toContain(
        'no-restricted-imports',
      );
    });
  });

  it('cửa chính viết dài vẫn qua — cổng không được cấm nhầm đường đúng', () => {
    const source = `import { VaultApiService } from '../../modules/vault/vault.api';
export type Probe = VaultApiService;
`;
    withProbe(`${API_ROOT_MODULES}/devices/probe-ad2-door.ts`, source, () => {
      expect(lint(`${API_ROOT_MODULES}/devices/probe-ad2-door.ts`)).toBe('');
    });
  });

  /**
   * Hai file dưới đây là hai file DUY NHẤT trong `src/modules/` từng bị `'off'` cả cụm.
   * Ngoại lệ khai theo ĐƯỜNG DẪN FILE, nên file mồi đặt cạnh chúng không trả lời được câu
   * hỏi. Hỏi thẳng eslint bằng `--print-config` thay vì ghi đè file nguồn thật.
   */
  describe('ngoại lệ thư viện KHÔNG được kéo theo việc tắt AD-2', () => {
    const ad2Of = (relPath: string) => {
      const rule = printConfig(relPath).rules['no-restricted-imports'];
      const options = rule?.[1] as
        | { paths?: { name: string }[]; patterns?: { regex: string }[] }
        | undefined;
      return {
        // `--print-config` chuẩn hóa mức về SỐ: 0 = off, 2 = error.
        severity: rule?.[0],
        libraries: (options?.paths ?? []).map((p) => p.name),
        hasAd2: (options?.patterns ?? []).length > 0,
      };
    };

    it('mail-transport.service.ts: bỏ ĐÚNG nodemailer, giữ nguyên AD-2', () => {
      const got = ad2Of(`${API_ROOT_MODULES}/mail/mail-transport.service.ts`);
      expect(got.severity).toBe(2);
      expect(got.hasAd2).toBe(true);
      expect(got.libraries).not.toContain('nodemailer');
      // Các lệnh cấm KHÁC không được rơi theo: file này không có lý do gì đụng argon2.
      expect(got.libraries).toContain('@node-rs/argon2');
      expect(got.libraries).toContain('exceljs');
    });

    it('password.service.ts: bỏ ĐÚNG argon2, giữ nguyên AD-2', () => {
      const got = ad2Of(`${API_ROOT_MODULES}/auth/password.service.ts`);
      expect(got.severity).toBe(2);
      expect(got.hasAd2).toBe(true);
      expect(got.libraries).not.toContain('@node-rs/argon2');
      expect(got.libraries).toContain('nodemailer');
    });

    it('module bình thường vẫn bị cấm cả hai thư viện — ngoại lệ không lan ra', () => {
      const got = ad2Of(`${API_ROOT_MODULES}/devices/devices.service.ts`);
      expect(got.hasAd2).toBe(true);
      expect(got.libraries).toContain('nodemailer');
      expect(got.libraries).toContain('@node-rs/argon2');
    });

    it('luật cấm CÚ PHÁP không bị tắt lây ở hai file đó', () => {
      for (const f of [
        `${API_ROOT_MODULES}/mail/mail-transport.service.ts`,
        `${API_ROOT_MODULES}/auth/password.service.ts`,
      ]) {
        const syntax = printConfig(f).rules['no-restricted-syntax'];
        expect(syntax?.[0]).toBe(2);
        // Cả hai file đều KHÔNG cần miễn: chúng đọc `SMTP_HOST/PORT/USER` và `readSecretFile`,
        // không đọc `SMTP_PASSWORD` từ env và không gọi `createCipheriv`.
        expect((syntax?.length ?? 0) - 1).toBeGreaterThan(0);
      }
    });

    /**
     * Vế đối chứng: ngoại lệ phải HẸP tới từng file, không mở cho cả thư mục — ngoại lệ quá
     * rộng kiểu này đã từng lọt một lần.
     */
    it('file khác trong chính thư mục mail KHÔNG được import nodemailer', () => {
      const source = `import { createTransport } from 'nodemailer';
export const t = createTransport;
`;
      withProbe(`${API_ROOT_MODULES}/mail/probe-mail-other.ts`, source, () => {
        expect(lint(`${API_ROOT_MODULES}/mail/probe-mail-other.ts`)).toContain('nodemailer');
      });
    });
  });

  /** Hai file thật phải sạch — nếu không, bản vá vừa làm gãy chính chỗ nó định cho phép. */
  it('hai file thật vẫn lint sạch sau khi thu hẹp ngoại lệ', () => {
    expect(lint(`${API_ROOT_MODULES}/mail/mail-transport.service.ts`)).toBe('');
    expect(lint(`${API_ROOT_MODULES}/auth/password.service.ts`)).toBe('');
  });
});
