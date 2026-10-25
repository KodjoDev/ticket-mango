import MailComposer from 'nodemailer/lib/mail-composer';
import { ImapPoller, type ImapSession } from '../src/services/email/imap';
import { SecretBox } from '../src/lib/secrets';
import { actor, describeDb, PASSWORD, resetDb, setup, teardown, type TestContext } from './helpers';

type Mail = ConstructorParameters<typeof MailComposer>[0];
const raw = async (mail: Mail): Promise<Buffer> => new MailComposer({ date: new Date(), ...mail }).compile().build();

/** Corps multipart/form-data minimal pour fastify.inject. */
function multipart(fields: Record<string, string>, files: { field: string; filename: string; type: string; data: Buffer }[]) {
  const boundary = '----test' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`));
    parts.push(f.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const JWT_SECRET = 'x'.repeat(32);

describeDb('messagerie', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.mail.sent.length = 0;
    ctx.mail.failNext = 0;
  });

  const TOKEN = 'a'.repeat(64);
  const mailbox = (data: object = {}) =>
    ctx.prisma.mailbox.create({ data: { name: 'Support', address: 'support@mango.test', webhookToken: TOKEN, ...data } });
  const receive = async (mail: Mail, mailboxId: string | null = null) => ctx.app.inbound.process(await raw(mail), mailboxId);

  describe('création de ticket par e-mail', () => {
    it('crée le contact, le ticket, les pièces jointes et l’accusé de réception', async () => {
      const box = await mailbox();
      const result = await receive(
        {
          from: 'Claire Lefèvre <Claire@Client.fr>',
          to: 'support@mango.test',
          subject: 'Export CSV vide',
          messageId: '<first@client.fr>',
          text: 'Bonjour,\nle fichier exporté est vide.',
          attachments: [{ filename: 'export.csv', content: 'a;b\n' }],
        },
        box.id,
      );
      expect(result).toMatchObject({ status: 'PROCESSED', ticketId: 1 });

      const contact = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'claire@client.fr' } });
      expect(contact).toMatchObject({ name: 'Claire Lefèvre', role: 'EXTERNAL_USER', passwordHash: null });
      const ticket = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: 1 }, include: { attachments: true } });
      expect(ticket).toMatchObject({ subject: 'Export CSV vide', channel: 'EMAIL', mailboxId: box.id, requesterId: contact.id, awaitingAgent: true });
      expect(ticket.description).toContain('le fichier exporté est vide');
      expect(ticket.attachments.map((a) => [a.filename, a.size])).toEqual([['export.csv', 4]]);

      await ctx.app.mailer.processPending();
      expect(ctx.mail.sent).toHaveLength(1);
      expect(ctx.mail.sent[0]).toMatchObject({
        to: 'claire@client.fr',
        from: 'Support <support@mango.test>',
        subject: '[TICKET #1] Export CSV vide',
        inReplyTo: '<first@client.fr>',
      });
      expect(ctx.mail.sent[0]!.text).toContain('enregistrée sous le numéro #1');
      expect(ctx.mail.sent[0]!.headers['Auto-Submitted']).toBe('auto-replied');
    });

    it('n’accepte qu’une fois un même message', async () => {
      const mail = { from: 'a@client.fr', subject: 'Doublon', messageId: '<dup@client.fr>', text: 'x' };
      expect((await receive(mail)).status).toBe('PROCESSED');
      expect((await receive(mail)).status).toBe('DUPLICATE');
      expect(await ctx.prisma.ticket.count()).toBe(1);
    });

    it('applique le type et le groupe par défaut de la boîte', async () => {
      const box = await mailbox({ address: 'bugs@mango.test', defaultType: 'BUG', defaultGroupId: '00000000-0000-4000-8000-000000000003' });
      const { ticketId } = await receive({ from: 'a@client.fr', subject: 'Plantage', text: 'Erreur 500' }, box.id);
      expect(await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({
        type: 'BUG',
        groupId: '00000000-0000-4000-8000-000000000003',
      });
    });

    it('convertit un e-mail HTML seul en texte', async () => {
      const { ticketId } = await receive({ from: 'a@client.fr', subject: 'HTML', html: '<p>Bonjour</p><p><b>Urgent</b> merci</p>' });
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).description).toBe('Bonjour\n\nUrgent merci');
    });
  });

  describe('fil de discussion', () => {
    async function scenario() {
      await mailbox();
      const { ticketId } = await receive({ from: 'Claire <claire@client.fr>', subject: 'Export vide', messageId: '<m1@client.fr>', text: 'Le CSV est vide.' });
      const agent = await actor(ctx, 'AGENT_N1');
      return { ticketId: ticketId!, agent };
    }

    it('envoie la réponse de l’agent par e-mail, dans le fil', async () => {
      const { ticketId, agent } = await scenario();
      await ctx.app.mailer.processPending();
      ctx.mail.sent.length = 0;

      const reply = (await agent.post(`/tickets/${ticketId}/comments`, { body: 'Pouvez-vous préciser la date ?' })).json();
      await agent.post(`/tickets/${ticketId}/comments`, { body: 'Note privée', isInternal: true });
      await ctx.app.mailer.processPending();

      expect(ctx.mail.sent).toHaveLength(1);
      const sent = ctx.mail.sent[0]!;
      expect(sent.subject).toBe(`[TICKET #${ticketId}] Export vide`);
      expect(sent.text).toContain('Pouvez-vous préciser la date ?');
      expect(sent.text.startsWith('##- Répondez au-dessus de cette ligne -##')).toBe(true);
      expect(sent.references).toContain('<m1@client.fr>');
      const comment = await ctx.prisma.comment.findUniqueOrThrow({ where: { id: reply.id } });
      expect(comment.messageId).toBe(sent.messageId);

      const comments = (await agent.get(`/tickets/${ticketId}/comments`)).json();
      expect(comments[0].outbound[0]).toMatchObject({ status: 'SENT', toAddress: 'claire@client.fr' });
    });

    it('rattache la réponse du client au ticket, sans la citation', async () => {
      const { ticketId, agent } = await scenario();
      await agent.post(`/tickets/${ticketId}/comments`, { body: 'Quelle date ?' });
      await ctx.app.mailer.processPending();
      const ours = ctx.mail.sent.at(-1)!;

      const result = await receive({
        from: 'claire@client.fr',
        subject: `Re: ${ours.subject}`,
        inReplyTo: ours.messageId,
        references: [ours.messageId],
        text: `Hier vers 10h.\n\nLe lun. 27 oct. 2026 à 10:00, Support <support@mango.test> a écrit :\n> ${ours.text}`,
      });
      expect(result).toMatchObject({ status: 'PROCESSED', ticketId });
      const comment = await ctx.prisma.comment.findUniqueOrThrow({ where: { id: result.commentId } });
      expect(comment).toMatchObject({ body: 'Hier vers 10h.', channel: 'EMAIL', isInternal: false });
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).awaitingAgent).toBe(true);
    });

    it('retrouve le ticket par le numéro du sujet pour le demandeur, pas pour un tiers', async () => {
      const { ticketId } = await scenario();
      const mine = await receive({ from: 'claire@client.fr', subject: `RE: [TICKET #${ticketId}] Export vide`, text: 'Toujours vide.' });
      expect(mine.ticketId).toBe(ticketId);
      const stranger = await receive({ from: 'intrus@ailleurs.fr', subject: `[TICKET #${ticketId}] Export vide`, text: 'Je m’invite.' });
      expect(stranger.status).toBe('PROCESSED');
      expect(stranger.ticketId).not.toBe(ticketId);
    });

    it('publie la réponse d’un agent envoyée depuis sa messagerie', async () => {
      const { ticketId, agent } = await scenario();
      const result = await receive({ from: agent.user.email, subject: `[TICKET #${ticketId}] Export vide`, text: 'Corrigé, merci.' });
      const comment = await ctx.prisma.comment.findUniqueOrThrow({ where: { id: result.commentId } });
      expect(comment.authorId).toBe(agent.user.id);
      const ticket = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(ticket.firstResponseAt).not.toBeNull();
    });

    it('ouvre un nouveau ticket quand on répond à un ticket clôturé', async () => {
      const { ticketId, agent } = await scenario();
      await agent.post(`/tickets/${ticketId}/status`, { status: 'CLOSED' });
      const result = await receive({ from: 'claire@client.fr', subject: `Re: [TICKET #${ticketId}] Export vide`, text: 'Le problème revient.' });
      expect(result.ticketId).not.toBe(ticketId);
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId } })).description).toContain(`Suite du ticket #${ticketId}`);
    });
  });

  describe('filtrage', () => {
    it('écarte les réponses automatiques, le spam et les boucles', async () => {
      await mailbox();
      expect(
        (await receive({ from: 'claire@client.fr', subject: 'Absent du bureau', text: 'Je suis absente', headers: { 'Auto-Submitted': 'auto-replied' } })).status,
      ).toBe('AUTO_REPLY');
      expect((await receive({ from: 'MAILER-DAEMON@mx.client.fr', subject: 'Undelivered Mail', text: 'x' })).status).toBe('AUTO_REPLY');
      expect((await receive({ from: 'x@client.fr', subject: 'Promo', text: 'x', headers: { 'X-Spam-Flag': 'YES' } })).status).toBe('SPAM');
      expect((await receive({ from: 'support@mango.test', subject: 'Boucle', text: 'x' })).status).toBe('LOOP');

      await ctx.prisma.setting.create({ data: { key: 'emailSettings', value: { blocklist: ['@spam.io'] } } });
      expect((await receive({ from: 'vente@news.spam.io', subject: 'Offre', text: 'x' })).status).toBe('SPAM');
      expect(await ctx.prisma.ticket.count()).toBe(0);

      const log = await ctx.prisma.inboundEmail.findFirstOrThrow({ where: { fromAddress: 'vente@news.spam.io' } });
      expect(log.rawKey).not.toBeNull();
    });

    it('coupe une rafale d’un même expéditeur', async () => {
      await ctx.prisma.setting.create({ data: { key: 'emailSettings', value: { maxPerSenderPerHour: 2 } } });
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await receive({ from: 'robot@client.fr', subject: `Alerte ${i}`, text: 'x' })).status);
      expect(statuses).toEqual(['PROCESSED', 'PROCESSED', 'LOOP', 'LOOP']);
    });

    it('retraite un message écarté à tort une fois la règle corrigée', async () => {
      const admin = await actor(ctx, 'ADMIN');
      await ctx.prisma.setting.create({ data: { key: 'emailSettings', value: { blocklist: ['@client.fr'] } } });
      await receive({ from: 'vip@client.fr', subject: 'Important', text: 'x' });
      const log = await ctx.prisma.inboundEmail.findFirstOrThrow();
      await admin.put('/admin/email-settings', { acknowledge: false, blocklist: [], maxPerSenderPerHour: 20 });
      const retried = (await admin.post(`/admin/inbound/${log.id}/retry`)).json();
      expect(retried).toMatchObject({ status: 'PROCESSED', ticketId: 1 });
    });
  });

  describe('réception par webhook', () => {
    it('accepte le MIME brut et le champ « email » d’un formulaire, avec le bon jeton', async () => {
      await mailbox();
      const ok = await ctx.app.inject({
        method: 'POST',
        url: `/inbound/email/${TOKEN}`,
        headers: { 'content-type': 'message/rfc822' },
        payload: await raw({ from: 'a@client.fr', subject: 'Webhook brut', text: 'x' }),
      });
      expect(ok.json()).toMatchObject({ status: 'PROCESSED', ticketId: 1 });

      const form = multipart({ email: (await raw({ from: 'b@client.fr', subject: 'SendGrid', text: 'y' })).toString() }, []);
      const viaForm = await ctx.app.inject({ method: 'POST', url: `/inbound/email/${TOKEN}`, ...form });
      expect(viaForm.json()).toMatchObject({ status: 'PROCESSED', ticketId: 2 });

      const wrong = await ctx.app.inject({
        method: 'POST',
        url: `/inbound/email/${'b'.repeat(64)}`,
        headers: { 'content-type': 'message/rfc822' },
        payload: await raw({ from: 'a@client.fr', subject: 'x', text: 'x' }),
      });
      expect(wrong.statusCode).toBe(404);
    });
  });

  describe('relève IMAP', () => {
    it('traite les nouveaux messages, les marque lus et avance le curseur', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const box = (
        await admin.post('/admin/mailboxes', {
          name: 'Support',
          address: 'support@mango.test',
          imapHost: 'imap.mango.test',
          imapUser: 'support',
          imapPassword: 'motdepasse-imap',
        })
      ).json();
      expect(box).toMatchObject({ hasPassword: true });
      expect(box).not.toHaveProperty('imapPasswordEnc');
      expect(box.webhookUrl).toMatch(/\/api\/inbound\/email\/[0-9a-f]{64}$/);
      const stored = await ctx.prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } });
      expect(stored.imapPasswordEnc).not.toContain('motdepasse');

      const seen: number[] = [];
      let connectedWith: unknown;
      const messages = [
        { uid: 7, source: await raw({ from: 'a@client.fr', subject: 'Un', text: '1' }) },
        { uid: 9, source: await raw({ from: 'b@client.fr', subject: 'Deux', text: '2' }) },
      ];
      const session: ImapSession = {
        uidValidity: 42n,
        async *fetchNew(after) {
          for (const m of messages) if (after === null || m.uid > after) yield m;
        },
        markSeen: async (uid) => void seen.push(uid),
        close: async () => undefined,
      };
      // Même clé que l'application de test (dérivée du secret JWT) pour relire le mot de passe.
      const poller = new ImapPoller(ctx.prisma, ctx.app.inbound, new SecretBox(undefined, JWT_SECRET), async (config) => {
        connectedWith = config;
        return session;
      });

      const mb = await ctx.prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } });
      expect(await poller.pollMailbox(mb)).toEqual({ processed: 2 });
      expect(connectedWith).toMatchObject({ host: 'imap.mango.test', port: 993, password: 'motdepasse-imap', folder: 'INBOX' });
      expect(seen).toEqual([7, 9]);
      const after = await ctx.prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } });
      expect(after).toMatchObject({ lastUid: 9, uidValidity: 42n, lastError: null });

      // Bail en cours : pas de seconde relève simultanée.
      expect(await poller.pollMailbox(after)).toEqual({ processed: 0 });
      expect(await ctx.prisma.ticket.count()).toBe(2);
    });

    it('enregistre l’erreur de connexion sur la boîte', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const box = (
        await admin.post('/admin/mailboxes', { name: 'S', address: 's@mango.test', imapHost: 'imap.x', imapUser: 'u', imapPassword: 'p' })
      ).json();
      const poller = new ImapPoller(ctx.prisma, ctx.app.inbound, new SecretBox(undefined, JWT_SECRET), async () => {
        throw new Error('Authentification refusée');
      });
      await poller.pollMailbox(await ctx.prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } }));
      expect((await ctx.prisma.mailbox.findUniqueOrThrow({ where: { id: box.id } })).lastError).toBe('Authentification refusée');
    });
  });

  describe('envoi : reprise sur échec', () => {
    it('réessaie avec un délai croissant puis abandonne', async () => {
      await mailbox();
      await receive({ from: 'a@client.fr', subject: 'Retry', text: 'x' });
      ctx.mail.failNext = 10;
      let now = new Date();
      for (let i = 0; i < 5; i++) {
        await ctx.app.mailer.processPending(now);
        now = new Date(now.getTime() + 2 * 3_600_000);
      }
      const email = await ctx.prisma.outboundEmail.findFirstOrThrow();
      expect(email).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'Serveur SMTP indisponible' });
    });

    it('envoie après un échec passager', async () => {
      await mailbox();
      await receive({ from: 'a@client.fr', subject: 'Retry', text: 'x' });
      ctx.mail.failNext = 1;
      const now = new Date();
      expect(await ctx.app.mailer.processPending(now)).toEqual({ sent: 0, failed: 1 });
      // Pas de nouvel essai avant le délai d'une minute.
      expect(await ctx.app.mailer.processPending(new Date(now.getTime() + 30_000))).toEqual({ sent: 0, failed: 0 });
      expect(await ctx.app.mailer.processPending(new Date(now.getTime() + 61_000))).toEqual({ sent: 1, failed: 0 });
    });
  });

  describe('pièces jointes', () => {
    it('joint des fichiers à une réponse et les protège selon le rôle', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await client.post('/tickets', { subject: 'Logs', description: 'Voir pièce jointe' })).json();

      const upload = (body: string, isInternal: boolean, file: { filename: string; type: string; data: Buffer }) => {
        const form = multipart({ body, isInternal: String(isInternal) }, [{ field: 'file', ...file }]);
        return ctx.app.inject({ method: 'POST', url: `/tickets/${id}/comments`, payload: form.payload, headers: { ...form.headers, authorization: agent.token } });
      };
      const pub = (await upload('Voici le correctif', false, { filename: '../../patch.html', type: 'text/html', data: Buffer.from('<script>x</script>') })).json();
      const priv = (await upload('Logs serveur', true, { filename: 'server.log', type: 'text/plain', data: Buffer.from('secret') })).json();
      expect(pub.attachments[0]).toMatchObject({ filename: 'patch.html', size: 18 });

      const download = (who: { token: string }, attachmentId: string) =>
        ctx.app.inject({ method: 'GET', url: `/attachments/${attachmentId}`, headers: { authorization: who.token } });
      const res = await download(client, pub.attachments[0].id);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('<script>x</script>');
      // Jamais interprété par le navigateur.
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toBe("attachment; filename*=UTF-8''patch.html");
      expect((await download(client, priv.attachments[0].id)).statusCode).toBe(404);
      expect((await download(agent, priv.attachments[0].id)).statusCode).toBe(200);
    });
  });

  describe('fusion de doublons', () => {
    it('ferme le doublon, recopie son contenu et redirige ses e-mails', async () => {
      await mailbox();
      const agent = await actor(ctx, 'AGENT_N1');
      const target = await receive({ from: 'claire@client.fr', subject: 'Export vide', text: 'Premier signalement' });
      const source = await receive({ from: 'marc@client.fr', subject: 'CSV vide aussi', messageId: '<dup-src@client.fr>', text: 'Même souci' });

      const merged = await agent.post(`/tickets/${source.ticketId}/merge`, { targetId: target.ticketId });
      expect(merged.statusCode).toBe(200);
      const closed = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: source.ticketId } });
      expect(closed).toMatchObject({ status: 'CLOSED', mergedIntoId: target.ticketId });
      const notes = (await agent.get(`/tickets/${target.ticketId}/comments`)).json();
      expect(notes.at(-1)).toMatchObject({ isInternal: true });
      expect(notes.at(-1).body).toContain('Même souci');

      // Le demandeur du doublon qui répond dans son fil arrive dans le ticket conservé
      // (ici on lui donne ce ticket pour vérifier la redirection).
      await ctx.prisma.ticket.update({ where: { id: target.ticketId }, data: { requesterId: closed.requesterId } });
      const reply = await receive({ from: 'marc@client.fr', subject: 'Re: CSV vide aussi', inReplyTo: '<dup-src@client.fr>', text: 'Des nouvelles ?' });
      expect(reply.ticketId).toBe(target.ticketId);

      expect((await agent.post(`/tickets/${target.ticketId}/merge`, { targetId: target.ticketId })).statusCode).toBe(400);
      expect((await agent.post(`/tickets/${source.ticketId}/merge`, { targetId: target.ticketId })).statusCode).toBe(409);
    });
  });

  it('empêche un contact créé par e-mail de se connecter', async () => {
    await receive({ from: 'contact@client.fr', subject: 'x', text: 'x' });
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'contact@client.fr', password: PASSWORD } });
    expect(res.statusCode).toBe(401);
  });
});
