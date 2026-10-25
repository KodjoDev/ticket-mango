import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('vérifie un mot de passe correct et rejette un mauvais', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('mauvais', hash)).resolves.toBe(false);
  });

  it('produit un sel différent à chaque hash', async () => {
    const [a, b] = await Promise.all([hashPassword('x'), hashPassword('x')]);
    expect(a).not.toBe(b);
  });

  it('rejette un hash mal formé', async () => {
    await expect(verifyPassword('x', 'bcrypt$abc')).resolves.toBe(false);
  });
});
