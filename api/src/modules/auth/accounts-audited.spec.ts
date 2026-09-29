import 'reflect-metadata';
import { AUDITED_KEY, Audited, type AuditedMeta } from '../audit/audited.decorator';
import { AccountsController } from './accounts.controller';
import { ACCOUNT_STATUS_ACTION } from './accounts.service';

/** `SetMetadata` trên method gắn vào chính hàm; đọc qua descriptor để khỏi tách method khỏi lớp. */
function auditedOf(proto: object, method: string): AuditedMeta {
  const fn: unknown = Object.getOwnPropertyDescriptor(proto, method)?.value;
  return Reflect.getMetadata(AUDITED_KEY, fn as object) as AuditedMeta;
}

/**
 * OLD-BE-03 — tên khai ở `@Audited` phải là tên THẬT có trong `audit_log`.
 *
 * Người đọc controller (và người lọc màn Nhật ký) tin vào tên đó. Route đổi trạng thái tài
 * khoản từng khai `account.status.changed` trong khi service ghi `account.locked` /
 * `account.disabled` / `account.unlocked` — lọc theo tên khai thì không ra dòng nào.
 */
describe('@Audited của đổi trạng thái tài khoản khớp mã service ghi', () => {
  it('khai đúng tập mã mà setStatus ghi', () => {
    const meta = auditedOf(AccountsController.prototype, 'setStatus');
    expect([...meta.actions].sort()).toEqual(Object.values(ACCOUNT_STATUS_ACTION).sort());
    expect(meta.writtenByService).toBe(true);
  });

  it('mỗi trạng thái ra đúng một mã', () => {
    expect(ACCOUNT_STATUS_ACTION).toEqual({
      active: 'account.unlocked',
      locked: 'account.locked',
      disabled: 'account.disabled',
    });
  });
});

describe('@Audited nhiều mã', () => {
  it('một mã: actions chỉ có mã đó', () => {
    class Probe {
      @Audited('device.created', 'device')
      run(): void {}
    }
    const meta = auditedOf(Probe.prototype, 'run');
    expect(meta).toMatchObject({ action: 'device.created', actions: ['device.created'] });
  });

  it('nhiều mã mà không để service ghi thì ném ngay lúc khai — interceptor chỉ ghi được một', () => {
    expect(() => Audited(['a.one', 'a.two'], 'user')).toThrow(/writtenByService/);
  });
});
