import { EnvelopeCryptoService } from '../../common/crypto/envelope.service';
import { MasterKeyRing } from '../../common/crypto/master-key-ring';
import { diagramDraftKey } from './diagram-draft-key';

const crypto = new EnvelopeCryptoService(new MasterKeyRing(`1=${'a'.repeat(64)}`));

describe('diagramDraftKey — khoá mã bản vẽ dở ở trình duyệt (Q-23 06/10)', () => {
  it('base64 của 32 byte, theo người + bản vẽ', () => {
    const key = diagramDraftKey(crypto, 'user-1', 'diagram-1');
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
    expect(key).toBe(crypto.deriveKey('diagram-draft|user-1|diagram-1').toString('base64'));
  });

  it.each([
    ['người khác', 'user-2', 'diagram-1'],
    ['bản vẽ khác', 'user-1', 'diagram-2'],
  ])('%s → khoá khác (người dùng chung máy không giải được bản dở của nhau)', (_name, user, diagram) => {
    expect(diagramDraftKey(crypto, user, diagram)).not.toBe(diagramDraftKey(crypto, 'user-1', 'diagram-1'));
  });
});
