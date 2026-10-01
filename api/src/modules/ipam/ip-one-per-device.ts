import { ConflictException } from '@nestjs/common';

/** Chỉ mục duy nhất của `0037_ip_one_per_device.sql` — một máy tối đa một IP đang cấp (Q-20). */
export const DEVICE_ONE_IP_CONSTRAINT = 'ip_address_device_uq';

export function deviceHasIp(address: string | null): ConflictException {
  return new ConflictException({
    code: 'DEVICE_HAS_IP',
    message:
      (address
        ? `Thiết bị này đã có IP ${address}. `
        : 'Thiết bị này đã có một IP đang cấp khác. ') +
      'Mỗi thiết bị chỉ giữ một IP — muốn chuyển sang địa chỉ khác thì bấm "Đổi IP" trên hồ sơ thiết bị.',
  });
}
