import type { Mailbox, PrismaClient } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import type { SecretBox } from '../../lib/secrets';
import type { InboundService } from './inbound';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  folder: string;
}

/** Session IMAP minimale : ce dont la relève a besoin (permet de la simuler dans les tests). */
export interface ImapSession {
  uidValidity: bigint;
  /** Messages à traiter : non lus au premier passage, puis ceux d'UID supérieur au curseur. */
  fetchNew(afterUid: number | null): AsyncIterable<{ uid: number; source: Buffer }>;
  markSeen(uid: number): Promise<void>;
  close(): Promise<void>;
}

export type ImapConnector = (config: ImapConfig) => Promise<ImapSession>;

export const imapflowConnector: ImapConnector = async (c) => {
  const client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.password },
    logger: false,
    socketTimeout: 60_000,
  });
  await client.connect();
  const lock = await client.getMailboxLock(c.folder);
  const mailbox = client.mailbox;
  return {
    uidValidity: mailbox ? BigInt(mailbox.uidValidity) : 0n,
    async *fetchNew(afterUid) {
      const uids =
        afterUid === null
          ? ((await client.search({ seen: false }, { uid: true })) || [])
          : ((await client.search({ uid: `${afterUid + 1}:*` }, { uid: true })) || []).filter((u) => u > afterUid);
      for (const uid of [...uids].sort((a, b) => a - b)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (msg && msg.source) yield { uid, source: msg.source };
      }
    },
    async markSeen(uid) {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    },
    async close() {
      lock.release();
      await client.logout();
    },
  };
};

/**
 * Relève périodique des boîtes IMAP. Le curseur (UIDVALIDITY, dernier UID) avance
 * message par message : une interruption reprend là où elle s'était arrêtée, et la
 * déduplication par Message-ID protège des doublons.
 */
export class ImapPoller {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly inbound: InboundService,
    private readonly secrets: SecretBox,
    private readonly connect: ImapConnector = imapflowConnector,
  ) {}

  config(m: Mailbox): ImapConfig | null {
    if (!m.imapHost || !m.imapUser || !m.imapPasswordEnc) return null;
    return {
      host: m.imapHost,
      port: m.imapPort ?? (m.imapSecure ? 993 : 143),
      secure: m.imapSecure,
      user: m.imapUser,
      password: this.secrets.decrypt(m.imapPasswordEnc),
      folder: m.imapFolder,
    };
  }

  /** Vérifie les paramètres de connexion d'une boîte (bouton « Tester »). */
  async test(m: Mailbox): Promise<{ ok: boolean; error?: string }> {
    const config = this.config(m);
    if (!config) return { ok: false, error: 'Paramètres IMAP incomplets' };
    try {
      const session = await this.connect(config);
      await session.close();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async pollMailbox(mailbox: Mailbox, now = new Date()): Promise<{ processed: number }> {
    // Bail de 50 s : une autre instance ne relève pas la même boîte en même temps.
    const { count } = await this.prisma.mailbox.updateMany({
      where: { id: mailbox.id, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 50_000) } }] },
      data: { lastCheckedAt: now },
    });
    if (count === 0) return { processed: 0 };

    const config = this.config(mailbox);
    if (!config) return { processed: 0 };
    let processed = 0;
    let session: ImapSession | null = null;
    try {
      session = await this.connect(config);
      // UIDVALIDITY changé : les UID ne sont plus comparables, on repart des non lus.
      let lastUid = mailbox.uidValidity === session.uidValidity ? mailbox.lastUid : null;
      await this.prisma.mailbox.update({ where: { id: mailbox.id }, data: { uidValidity: session.uidValidity, lastUid } });
      for await (const { uid, source } of session.fetchNew(lastUid)) {
        await this.inbound.process(source, mailbox.id);
        await session.markSeen(uid);
        lastUid = Math.max(lastUid ?? 0, uid);
        await this.prisma.mailbox.update({ where: { id: mailbox.id }, data: { lastUid } });
        processed++;
      }
      await this.prisma.mailbox.update({ where: { id: mailbox.id }, data: { lastError: null } });
    } catch (err) {
      await this.prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500) },
      });
    } finally {
      await session?.close().catch(() => undefined);
    }
    return { processed };
  }

  async pollAll() {
    const mailboxes = await this.prisma.mailbox.findMany({ where: { isActive: true, imapHost: { not: null } } });
    for (const m of mailboxes) await this.pollMailbox(m);
  }

  start(intervalMs: number, onError: (err: unknown) => void) {
    const tick = () => void this.pollAll().catch(onError);
    tick();
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
