import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { messagesOf } from '../../common/validation-messages';
import { SoftwareBodyDto } from './software.controller';

/**
 * SW-025 — Số ghế phải là số nguyên dương hoặc `null` (không giới hạn).
 *
 * `null` là một lựa chọn CÓ Ý ("không giới hạn ghế"), nên mọi thứ khác không phải số nguyên
 * dương phải bị từ chối chứ không được rơi về nó. Cửa web từng gửi `Number("10 ghế")` = NaN,
 * và `JSON.stringify(NaN)` là `null` — hồ sơ thành "không giới hạn" mà không ai được báo.
 * Phía web nay kiểm trước; bài này giữ cho API không nhận chuỗi/số lẻ/số âm dưới mọi dạng.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  stopAtFirstError: true,
  exceptionFactory: (errors) => new BadRequestException(messagesOf(errors)),
});
const run = (payload: Record<string, unknown>) =>
  pipe.transform(payload, { type: 'body', metatype: SoftwareBodyDto });

describe('SW-025 · DTO số ghế', () => {
  it.each([['10 ghế'], ['1,000'], ['10'], [''], [0], [-3], [2.5], [Number.NaN], [true]])(
    'seatTotal = %p → 400',
    async (seatTotal) => {
      await expect(run({ code: 'SW-01', seatTotal })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([[1], [250], [null]])('seatTotal = %p → qua', async (seatTotal) => {
    await expect(run({ code: 'SW-01', seatTotal })).resolves.toMatchObject({ seatTotal });
  });
});

/* Q-27: ghế riêng — hợp đồng / ghi chú từng ghế đi qua cùng hàng rào chữ như ghi chú hồ sơ. */
describe('Q-27 · DTO ghế riêng', () => {
  it('perSeat + seats hợp lệ → qua, seats thành mảng đối tượng', async () => {
    await expect(
      run({ code: 'LIC-01', perSeat: true, contract: 'PO-1', seats: [{ seatNo: 1, contract: 'PO-1-A', note: 'máy ảo' }] }),
    ).resolves.toMatchObject({ perSeat: true, seats: [{ seatNo: 1, contract: 'PO-1-A' }] });
  });

  it.each([
    [{ seats: [{ seatNo: 0 }] }],
    [{ seats: [{ seatNo: 'một' }] }],
    [{ seats: [{ seatNo: 1, extra: 'x' }] }],
    [{ perSeat: 'có' }],
    [{ contract: 'x'.repeat(201) }],
  ])('%j → 400', async (payload) => {
    await expect(run({ code: 'LIC-01', ...payload })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ghi chú ghế trông như mật khẩu → 400 (NoSecretText)', async () => {
    await expect(run({ code: 'LIC-01', seats: [{ seatNo: 1, note: 'mk admin Pmh@Server2026' }] })).rejects.toBeInstanceOf(BadRequestException);
  });
});
