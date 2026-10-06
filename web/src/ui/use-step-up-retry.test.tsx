import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { isStepUpCancelled, useStepUpRetry } from './use-step-up-retry';

/**
 * Đóng hộp hỏi mã 6 số là HỦY, không phải lỗi để báo. Mọi nơi gọi `useStepUpRetry().run` hỏi
 * cùng một câu này — một bản, để chữ `STEPUP_CANCELLED` không bị gõ lại (và gõ sai) ở từng màn.
 */
describe('isStepUpCancelled', () => {
  it.each<[unknown, boolean]>([
    [new Error('STEPUP_CANCELLED'), true],
    [new Error('STEPUP_REQUIRED'), false],
    [new Error('Lỗi mạng'), false],
    [null, false],
    [undefined, false],
    ['STEPUP_CANCELLED', false],
  ])('%s → %s', (error, expected) => {
    expect(isStepUpCancelled(error)).toBe(expected);
  });
});

/**
 * AD-17: hook đọc `scope` + `graceMinutes` từ chính lỗi server trả về rồi mở hộp ĐÚNG phạm vi,
 * gửi đúng phạm vi đó, và thử lại việc dở — hết ân hạn thì hỏi tại chỗ, không đá ra ngoài.
 * Web không tự đoán phạm vi từ màn đang đứng: route nào đòi phạm vi nào là việc của server.
 */
describe('useStepUpRetry — phạm vi lấy từ server', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function Harness({ action }: { action: () => Promise<string> }) {
    const stepUp = useStepUpRetry('csrf');
    const [result, setResult] = useState('');
    return (
      <>
        <button type="button" onClick={() => void stepUp.run(action, 'Mở bản vẽ E2E').then(setResult, () => undefined)}>
          Chạy
        </button>
        <output>{result}</output>
        {stepUp.dialog}
      </>
    );
  }

  /* K-04: phạm vi sơ đồ là hộp NHỎ như hộp mã két (tiêu đề "Nhập mã 6 số để mở sơ đồ" + đang mở gì
     + 6 ô + Hủy); phạm vi két giữ hộp xác thực đầy đủ. */
  it.each([
    ['diagram', 'Mở bản vẽ E2E'],
    ['vault', 'Mã này mở két và các thao tác cần mã, không mở phần xem sơ đồ.'],
  ] as const)('server đòi phạm vi %s → hộp hỏi đúng phạm vi, gửi đúng phạm vi, chạy lại', async (scope, note) => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { status: 'stepped-up', scope, graceMinutes: 4 })));
    vi.stubGlobal('fetch', fetchMock);
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError(401, { code: 'STEPUP_REQUIRED', scope, graceMinutes: 4 }))
      .mockResolvedValueOnce('đã mở');

    renderWithI18n(<Harness action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    expect(await screen.findByText(note)).toBeInTheDocument();
    if (scope === 'diagram') {
      const box = screen.getByRole('dialog', { name: 'Nhập mã 6 số để mở sơ đồ' });
      expect(box).not.toHaveTextContent('Mã này chỉ mở phần xem sơ đồ');
      expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument();
    }
    // Tiêu đề hộp nhỏ cũng có chữ "mã" — lấy ô mã, không lấy chính hộp.
    const otp = screen.getAllByLabelText(/mã/i).find((el) => el.getAttribute('role') !== 'dialog')!;
    await userEvent.type(otp, '654321');

    expect(await screen.findByText('đã mở')).toBeInTheDocument();
    expect(action).toHaveBeenCalledTimes(2);
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) =>
      String(url).includes('/api/v1/auth/step-up'),
    );
    expect(JSON.parse(String(call?.[1].body))).toEqual({ token: '654321', scope });
  });

  it('lỗi không mang `scope` → coi là két (route két cũ), không bao giờ là sơ đồ', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { status: 'stepped-up', graceMinutes: 10 }))));
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError(401, { code: 'STEPUP_REQUIRED' }))
      .mockResolvedValueOnce('ok');
    renderWithI18n(<Harness action={action} />);
    await userEvent.click(screen.getByRole('button', { name: 'Chạy' }));
    expect(
      await screen.findByText('Mã này mở két và các thao tác cần mã, không mở phần xem sơ đồ.'),
    ).toBeInTheDocument();
  });
});
