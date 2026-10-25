import { randomBytes } from 'node:crypto';
import { SecretBox } from './secrets';

describe('SecretBox', () => {
  it('chiffre et déchiffre, avec un résultat différent à chaque fois', () => {
    const box = new SecretBox(randomBytes(32).toString('base64'), 'x');
    const a = box.encrypt('mot de passe IMAP');
    expect(a).not.toContain('mot de passe');
    expect(a).not.toBe(box.encrypt('mot de passe IMAP'));
    expect(box.decrypt(a)).toBe('mot de passe IMAP');
  });

  it('refuse un secret altéré ou chiffré avec une autre clé', () => {
    const box = new SecretBox(undefined, 'jwt-secret-de-dev');
    const sealed = box.encrypt('secret');
    expect(() => new SecretBox(undefined, 'autre').decrypt(sealed)).toThrow();
    expect(() => box.decrypt(sealed.slice(0, -2) + 'AA')).toThrow();
  });

  it('exige une clé de 32 octets', () => {
    expect(() => new SecretBox(Buffer.from('court').toString('base64'), 'x')).toThrow();
  });
});
