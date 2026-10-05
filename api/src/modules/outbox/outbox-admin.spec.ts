import { maskEmails } from './outbox-admin';

/**
 * Màn "Thư gửi lỗi" (Q-25) hiện lỗi SMTP cuối cho SA; lỗi SMTP hay chép nguyên địa chỉ người nhận
 * ("550 5.1.1 <an.nguyen@pmh.com.vn>: user unknown") nên che phần trước `@` trước khi rời API.
 */
describe('maskEmails — che địa chỉ người nhận trong lỗi SMTP', () => {
  it.each([
    ['550 5.1.1 <an.nguyen@pmh.com.vn>: user unknown', '550 5.1.1 <a***@pmh.com.vn>: user unknown'],
    ['to=b@x.vn, c.d+tag@mail.example.com', 'to=b***@x.vn, c***@mail.example.com'],
    ['connect ETIMEDOUT 10.0.0.5:587', 'connect ETIMEDOUT 10.0.0.5:587'],
    ['', ''],
  ])('%s', (text, expected) => {
    expect(maskEmails(text)).toBe(expected);
  });
});
