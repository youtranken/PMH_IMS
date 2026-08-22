import { TotpService } from './totp.service';

const NOW = new Date('2026-08-22T10:00:00Z');
const STEP = Math.floor(NOW.getTime() / 1000 / 30);

describe('TotpService', () => {
  const svc = new TotpService();
  let secret: string;

  /** Test tự đóng vai app Authenticator: sinh mã đúng của một time step. */
  const tokenFor = (s: string, step: number) => svc.generateFor(s, step * 30);

  beforeAll(() => {
    secret = svc.generateSecret();
  });

  it('secret sinh ra là base32 đủ dài', () => {
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  });

  it('keyUri chứa issuer và email để app quét được', () => {
    const uri = svc.keyUri('sa@pmh.com.vn', secret);
    expect(uri).toContain('otpauth://totp/');
    expect(decodeURIComponent(uri)).toContain('sa@pmh.com.vn');
    expect(decodeURIComponent(uri)).toContain('IMS PMH');
  });

  it('mã đúng của time step hiện tại được chấp nhận', async () => {
    const result = await svc.verify({
      token: await tokenFor(secret, STEP),
      secret,
      lastUsedTimeStep: null,
      now: NOW,
    });
    expect(result).toEqual({ ok: true, timeStep: STEP });
  });

  it('chấp nhận lệch đồng hồ ±1 chu kỳ', async () => {
    for (const offset of [-1, 1]) {
      const result = await svc.verify({
        token: await tokenFor(secret, STEP + offset),
        secret,
        lastUsedTimeStep: null,
        now: NOW,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('từ chối mã lệch quá xa (3 chu kỳ)', async () => {
    const result = await svc.verify({
      token: await tokenFor(secret, STEP + 3),
      secret,
      lastUsedTimeStep: null,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid' });
  });

  it('CHỐNG REPLAY: mã đã dùng thì lần sau bị từ chối (NFR-01)', async () => {
    const token = await tokenFor(secret, STEP);
    const first = await svc.verify({ token, secret, lastUsedTimeStep: null, now: NOW });
    expect(first.ok).toBe(true);

    const replay = await svc.verify({
      token,
      secret,
      lastUsedTimeStep: first.timeStep as number,
      now: NOW,
    });
    expect(replay).toEqual({ ok: false, reason: 'replayed' });
  });

  it('CHỐNG REPLAY: mã của chu kỳ CŨ HƠN mốc đã dùng cũng bị từ chối', async () => {
    const result = await svc.verify({
      token: await tokenFor(secret, STEP - 1),
      secret,
      lastUsedTimeStep: STEP,
      now: NOW,
    });
    expect(result.reason).toBe('replayed');
  });

  it('mã của chu kỳ MỚI HƠN vẫn dùng được sau khi đã dùng mã cũ', async () => {
    const result = await svc.verify({
      token: await tokenFor(secret, STEP + 1),
      secret,
      lastUsedTimeStep: STEP,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.timeStep).toBe(STEP + 1);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 34 56x'])(
    'từ chối token sai định dạng: "%s"',
    async (token) => {
      const result = await svc.verify({ token, secret, lastUsedTimeStep: null, now: NOW });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid');
    },
  );

  it('bỏ khoảng trắng người dùng gõ thừa', async () => {
    const token = await tokenFor(secret, STEP);
    const spaced = `${token.slice(0, 3)} ${token.slice(3)}`;
    const result = await svc.verify({ token: spaced, secret, lastUsedTimeStep: null, now: NOW });
    expect(result.ok).toBe(true);
  });

  it('secret của người khác không mở được', async () => {
    const other = svc.generateSecret();
    const result = await svc.verify({
      token: await tokenFor(other, STEP),
      secret,
      lastUsedTimeStep: null,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});
