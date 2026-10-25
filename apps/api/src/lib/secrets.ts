import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Chiffrement des secrets stockés en base (mots de passe IMAP) : AES-256-GCM.
 * Format : v1.<iv>.<tag>.<chiffré>, en base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  /**
   * @param secretKey clé de 32 octets en base64 (SECRET_KEY). À défaut, une clé est dérivée
   *   du secret JWT : pratique en développement, mais changer JWT_SECRET rendrait alors les
   *   secrets illisibles. En production, fournir SECRET_KEY.
   */
  constructor(secretKey: string | undefined, fallbackSecret: string) {
    if (secretKey) {
      this.key = Buffer.from(secretKey, 'base64');
      if (this.key.length !== 32) throw new Error('SECRET_KEY doit faire 32 octets encodés en base64');
    } else {
      this.key = Buffer.from(hkdfSync('sha256', fallbackSecret, 'ticket-mango', 'mailbox-credentials', 32));
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Secret chiffré illisible');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
