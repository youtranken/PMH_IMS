import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';
import { ME_KEY } from '@/lib/api';
import { jsonResponse, render, screen, userEvent, waitFor } from '@/test/test-utils';
import type { Me } from '@/lib/me';
import { TotpEnroll } from './totp-enroll';

/**
 * A-02 phía trình duyệt: MÀN CÀI 2 LỚP PHẢI DỰNG ĐƯỢC Ô MẬT KHẨU KHI SERVER ĐÒI.
 *
 * ===== LỖ MÀ BÀI NÀY BẮT ĐƯỢC TRONG LÚC VIẾT =====
 *
 * `apiFetch` coi MỌI 401 là "phiên chết" trừ một danh sách loại trừ
 * (`USER_INPUT_401_CODES`), và loại trừ là cố ý: quên khai một mã mới thì người dùng bị đưa
 * về màn đăng nhập — phiền nhưng an toàn và tự thoát được.
 *
 * Chỉ có điều `REAUTH_REQUIRED` KHÔNG tự thoát được. Phiên vẫn sống, nên đăng nhập lại đưa
 * người dùng về đúng màn vừa đá họ ra, màn đó lại gọi `enroll`, lại 401, lại bị đá. Một vòng
 * kín, không lời giải thích. Bản vá phía API xanh hết mọi cổng và vẫn để lại cái vòng đó —
 * vì cả 449 bài E2E không bài nào đi qua đường "phiên đã đăng nhập thường đi cài 2 lớp":
 * E2E luôn cài 2 lớp ngay trong luồng đăng nhập bắt buộc, tức đường ĐƯỢC MIỄN.
 *
 * ===== VÌ SAO BÀI NÀY Ở TẦNG VITEST =====
 *
 * Câu hỏi là "màn hình phản ứng thế nào với một mã lỗi", không phải "server trả mã nào".
 * Dựng cảnh đó ở E2E cần một tài khoản không bắt 2 lớp rồi lái chuột qua một màn mà luồng
 * bình thường không dẫn tới; ở đây nó là ba dòng giả lập tầng mạng.
 *
 * ===== VÀ MỘT BÀI HỌC VỀ CHÍNH BÀI KIỂM NÀY =====
 *
 * Bản ĐẦU của nó chỉ khẳng định "ô mật khẩu có hiện không", và **đột biến sống sót**: bỏ
 * `'REAUTH_REQUIRED'` khỏi danh sách loại trừ mà cả ba bài vẫn xanh. Lý do — trong jsdom,
 * `window.location.href = ...` không đi đâu cả: không điều hướng, không ném, chỉ ghi một dòng
 * "Not implemented". `apiFetch` vẫn ném `ApiError` như thường, component vẫn đọc được `code`,
 * ô mật khẩu vẫn hiện. Bài xanh, còn người dùng thật thì đang ở màn đăng nhập.
 *
 * Nên bài phải khẳng định thẳng vào thứ đang hỏng: **`location.href` KHÔNG được đổi**. Đó là
 * khác biệt giữa "màn hình làm đúng" và "màn hình làm đúng trong một môi trường không có
 * trình duyệt".
 *
 * Kiểm chính bài này bằng đột biến: bỏ `'REAUTH_REQUIRED'` khỏi `USER_INPUT_401_CODES` ⇒
 * PHẢI đỏ.
 */

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * Tầng mạng giả: lượt gọi ĐẦU bị từ chối vì chưa có mật khẩu, lượt gọi có mật khẩu thì qua.
 * Đúng hợp đồng của `startTotpEnrollment` sau bản vá A-02.
 */
function stubEnrollApi(attemptsLeft = 4): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/auth/totp/enroll')) return Promise.resolve(jsonResponse(200, {}));
      calls += 1;
      const body = init?.body ? (JSON.parse(String(init.body)) as { currentPassword?: string }) : {};
      if (!body.currentPassword) {
        return Promise.resolve(
          jsonResponse(401, {
            code: 'REAUTH_REQUIRED',
            message: 'Nhập mật khẩu hiện tại để cài xác thực 2 lớp.',
          }),
        );
      }
      if (body.currentPassword !== 'dung-mat-khau') {
        return Promise.resolve(
          jsonResponse(401, {
            code: 'CURRENT_PASSWORD_WRONG',
            message: 'Mật khẩu hiện tại không đúng.',
            attemptsLeft,
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { secret: SECRET, qrDataUrl: 'data:image/png,x' }));
    }),
  );
  return { calls: () => calls };
}

function renderEnroll() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(ME_KEY, me);
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <TotpEnroll />
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

/**
 * Bắt mọi lượt gán `window.location.href`.
 *
 * `apiFetch` đá người dùng về màn đăng nhập bằng đúng một câu gán ấy. jsdom biến câu đó thành
 * một dòng log rồi đi tiếp, nên không thay `location` bằng một vật có setter đếm được thì
 * không có cách nào phân biệt "không đá" với "đá mà môi trường không đi đâu cả".
 */
function watchNavigation(): { to: () => string | null } {
  let target: string | null = null;
  vi.stubGlobal('location', {
    /*
     * KHAI TỪNG THUỘC TÍNH, KHÔNG `{...window.location}` (§18 #15, sửa 22/09).
     *
     * Trong jsdom, các thuộc tính của `Location` là ACCESSOR nằm trên prototype, nên phép
     * spread — vốn chỉ chép thuộc tính RIÊNG, khả liệt kê — cho ra một object gần như rỗng.
     * `location.origin` và `location.pathname` thành `undefined`.
     *
     * Bài này xanh vì đường đi của nó không đọc hai thứ đó — may, không phải thiết kế. Bài
     * kế tiếp ai đó viết trên cùng cái stub này sẽ gặp `undefined` và đi tìm lỗi ở chỗ khác.
     */
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    host: window.location.host,
    protocol: window.location.protocol,
    get href() {
      return 'http://localhost/';
    },
    set href(value: string) {
      target = value;
    },
  });
  return { to: () => target };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Màn cài 2 lớp — bước xác thực lại (A-02)', () => {
  it('server đòi mật khẩu thì màn dựng ô mật khẩu, KHÔNG đá về đăng nhập', async () => {
    const api = stubEnrollApi();
    const nav = watchNavigation();
    renderEnroll();

    const box = await screen.findByLabelText('Mật khẩu hiện tại');
    expect(box).toHaveAttribute('type', 'password');
    // Và không hiện chữ đỏ: đây là bước còn thiếu, không phải một lỗi người dùng vừa gây ra.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls()).toBe(1);
    // Vế thật sự đang được canh — xem docblock đầu file.
    expect(nav.to(), 'phiên còn sống thì không được đá ai về màn đăng nhập').toBeNull();
  });

  it('gõ đúng mật khẩu thì secret hiện ra — đường đúng vẫn đi được tới cùng', async () => {
    stubEnrollApi();
    renderEnroll();

    await userEvent.type(await screen.findByLabelText('Mật khẩu hiện tại'), 'dung-mat-khau');
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    await waitFor(() => expect(screen.getByTestId('totp-secret')).toHaveTextContent(SECRET));
    expect(screen.queryByLabelText('Mật khẩu hiện tại')).toBeNull();
  });

  it('gõ sai thì báo tại chỗ, xoá ô nhập, và vẫn ở lại màn này', async () => {
    stubEnrollApi();
    renderEnroll();

    const box = await screen.findByLabelText('Mật khẩu hiện tại');
    await userEvent.type(box, 'sai-mat-khau');
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Mật khẩu hiện tại không đúng.'),
    );
    expect(screen.getByLabelText('Mật khẩu hiện tại')).toHaveValue('');
    expect(screen.queryByTestId('totp-secret')).toBeNull();
  });

  /*
   * "Còn mấy lần" — hai vế, và vế PHỦ ĐỊNH quan trọng ngang vế khẳng định.
   *
   * Sai đủ ngưỡng thì phiên bị THU HỒI, nên người gõ nhầm phải được báo trước. Nhưng báo ngay
   * từ lần sai đầu thì tới lần thật sự sát ngưỡng câu ấy đã thành tiếng ồn quen tai — và một
   * bài kiểm chỉ có vế khẳng định sẽ để lọt đúng lỗi đó.
   */
  it('sát ngưỡng thì nói thẳng còn mấy lần', async () => {
    stubEnrollApi(1);
    renderEnroll();

    await userEvent.type(await screen.findByLabelText('Mật khẩu hiện tại'), 'sai-mat-khau');
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Còn 1 lần'));
    expect(screen.getByRole('alert')).toHaveTextContent('phải đăng nhập lại');
  });

  it('còn xa ngưỡng thì IM — một lần gõ nhầm không phải lúc doạ ai', async () => {
    stubEnrollApi(4);
    renderEnroll();

    await userEvent.type(await screen.findByLabelText('Mật khẩu hiện tại'), 'sai-mat-khau');
    await userEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Mật khẩu hiện tại không đúng.'),
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('Còn');
  });
});
