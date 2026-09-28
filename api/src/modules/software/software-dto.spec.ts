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
