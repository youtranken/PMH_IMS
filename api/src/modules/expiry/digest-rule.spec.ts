import { BadRequestException } from '@nestjs/common';
import { prepareDigestRule } from './expiry-digest.service';

/**
 * Loại trong luật mail phải là loại có nguồn thật. Nhận mọi chuỗi thì một luật chọn `isp`
 * (đã rời cỗ máy nhắc hạn — DOM-10) hay một chữ gõ sai lưu được mà không bao giờ khớp mục
 * nào: người tạo tưởng đã được nhắc.
 */
describe('prepareDigestRule — loại phải có thật', () => {
  const KNOWN = ['license', 'ssl', 'domain', 'maintenance', 'warranty'];
  const base = { name: 'Luật', recipients: ['it@pmh.com.vn'], frequency: 'daily' as const };

  it('loại có thật thì nhận', () => {
    expect(prepareDigestRule({ ...base, kinds: ['ssl', 'domain'] }, true, KNOWN)).toMatchObject({
      kinds: ['ssl', 'domain'],
    });
  });

  it('rỗng nghĩa là mọi loại — vẫn nhận', () => {
    expect(prepareDigestRule({ ...base, kinds: [] }, true, KNOWN)).toMatchObject({ kinds: [] });
  });

  it.each([[['isp']], [['ssl', 'sll']]])('loại không có nguồn %j → 400 RULE_KIND_UNKNOWN', (kinds) => {
    try {
      prepareDigestRule({ ...base, kinds }, true, KNOWN);
      throw new Error('phải ném');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ code: 'RULE_KIND_UNKNOWN' });
    }
  });
});
