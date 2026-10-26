import { actor, createUser, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('tickets', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(() => resetDb(ctx.prisma));

  const base = { subject: 'Erreur 500 au login', description: 'Impossible de me connecter depuis ce matin.' };

  describe('création et qualification', () => {
    it('crée un ticket externe avec la priorité par défaut de la matrice', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const res = await client.post('/tickets', { ...base, type: 'BUG', component: 'AUTH' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        id: 1,
        status: 'NEW',
        type: 'BUG',
        component: 'AUTH',
        impact: 'INDIVIDUAL',
        urgency: 'MEDIUM',
        priority: 'P4',
        priorityOverridden: false,
        requester: { id: client.user.id },
      });
    });

    it('refuse qu’un utilisateur externe fixe impact, urgence ou priorité', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      expect((await client.post('/tickets', { ...base, urgency: 'CRITICAL' })).statusCode).toBe(400);
      expect((await client.post('/tickets', { ...base, priority: 'P0' })).statusCode).toBe(400);
    });

    it('calcule P0 pour un impact global et une urgence critique', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const res = await agent.post('/tickets', { ...base, impact: 'ORGANIZATION', urgency: 'CRITICAL' });
      expect(res.json().priority).toBe('P0');
    });

    it('recalcule la priorité quand la qualification change et journalise la modification', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await client.post('/tickets', base)).json();

      const res = await agent.patch(`/tickets/${id}`, { impact: 'TEAM', urgency: 'HIGH', environment: 'PRODUCTION' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ priority: 'P2', environment: 'PRODUCTION' });

      const audit = (await agent.get(`/tickets/${id}/audit`)).json();
      expect(audit.map((a: { action: string }) => a.action)).toEqual(['ticket.created', 'ticket.updated']);
      expect(audit[1].changes).toMatchObject({
        impact: { from: 'INDIVIDUAL', to: 'TEAM' },
        priority: { from: 'P4', to: 'P2' },
      });
      expect(audit[1].actor.id).toBe(agent.user.id);
    });

    it('n’écrit pas d’audit pour une modification sans effet', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await agent.post('/tickets', base)).json();
      await agent.patch(`/tickets/${id}`, { impact: 'INDIVIDUAL' });
      expect((await agent.get(`/tickets/${id}/audit`)).json()).toHaveLength(1);
    });

    it('réserve le forçage de priorité au N2 et le conserve malgré les requalifications', async () => {
      const n1 = await actor(ctx, 'AGENT_N1');
      const n2 = await actor(ctx, 'AGENT_N2');
      const { id } = (await n1.post('/tickets', base)).json();

      expect((await n1.patch(`/tickets/${id}`, { priority: 'P1' })).statusCode).toBe(403);

      expect((await n2.patch(`/tickets/${id}`, { priority: 'P1' })).json()).toMatchObject({
        priority: 'P1',
        priorityOverridden: true,
      });
      expect((await n1.patch(`/tickets/${id}`, { urgency: 'LOW' })).json().priority).toBe('P1');

      // null annule le forçage : retour à la matrice (INDIVIDUAL × LOW = P4).
      expect((await n2.patch(`/tickets/${id}`, { priority: null })).json()).toMatchObject({
        priority: 'P4',
        priorityOverridden: false,
      });
    });

    it('n’assigne un ticket qu’à un agent actif', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const client = await actor(ctx, 'EXTERNAL_USER');
      const { id } = (await agent.post('/tickets', base)).json();

      expect((await agent.patch(`/tickets/${id}`, { assigneeId: client.user.id })).statusCode).toBe(400);
      const res = await agent.patch(`/tickets/${id}`, { assigneeId: agent.user.id });
      expect(res.json().assignee).toEqual({ id: agent.user.id, name: agent.user.name });
    });

    it('interdit au lecteur de créer ou modifier un ticket', async () => {
      const reader = await actor(ctx, 'READER');
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await agent.post('/tickets', base)).json();
      expect((await reader.post('/tickets', base)).statusCode).toBe(403);
      expect((await reader.patch(`/tickets/${id}`, { urgency: 'HIGH' })).statusCode).toBe(403);
      expect((await reader.get(`/tickets/${id}`)).statusCode).toBe(200);
    });
  });

  describe('demandeur', () => {
    it('laisse un agent créer le ticket pour le compte d’un client puis changer de demandeur', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const claire = await actor(ctx, 'EXTERNAL_USER');
      const marc = await actor(ctx, 'EXTERNAL_USER');

      const created = await agent.post('/tickets', { ...base, requesterId: claire.user.id });
      expect(created.json().requester.id).toBe(claire.user.id);
      const { id } = created.json();

      const res = await agent.patch(`/tickets/${id}`, { requesterId: marc.user.id });
      expect(res.statusCode).toBe(200);
      expect(res.json().requester.id).toBe(marc.user.id);
      // Le nouveau demandeur voit le ticket, l'ancien non.
      expect((await marc.get(`/tickets/${id}`)).statusCode).toBe(200);
      expect((await claire.get(`/tickets/${id}`)).statusCode).toBe(404);

      const audit = (await agent.get(`/tickets/${id}/audit`)).json();
      expect(audit.at(-1).changes).toEqual({
        requester: {
          from: `${claire.user.name} <${claire.user.email}>`,
          to: `${marc.user.name} <${marc.user.email}>`,
        },
      });
    });

    it('refuse le changement de demandeur à un client et vers un compte désactivé', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const client = await actor(ctx, 'EXTERNAL_USER');
      const inactive = await createUser(ctx.prisma, 'EXTERNAL_USER', { isActive: false });
      const { id } = (await client.post('/tickets', base)).json();

      expect((await client.patch(`/tickets/${id}`, { requesterId: agent.user.id })).statusCode).toBe(403);
      expect((await agent.patch(`/tickets/${id}`, { requesterId: inactive.id })).statusCode).toBe(400);
      expect((await agent.post('/tickets', { ...base, requesterId: inactive.id })).statusCode).toBe(400);
    });

    it('recherche les demandeurs et crée un contact externe sans mot de passe', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const client = await actor(ctx, 'EXTERNAL_USER');

      const found = await agent.get(`/requesters?q=${encodeURIComponent(client.user.email.toUpperCase())}`);
      expect(found.json().map((u: { id: string }) => u.id)).toEqual([client.user.id]);

      const created = await agent.post('/requesters', { email: 'Paul@Client.local', name: 'Paul Martin' });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ email: 'paul@client.local', role: 'EXTERNAL_USER' });
      const contact = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'paul@client.local' } });
      expect(contact.passwordHash).toBeNull();

      // Une adresse déjà connue renvoie le compte existant.
      const again = await agent.post('/requesters', { email: 'paul@client.local', name: 'Autre nom' });
      expect(again.statusCode).toBe(200);
      expect(again.json().id).toBe(contact.id);

      expect((await client.get('/requesters')).statusCode).toBe(403);
      expect((await client.post('/requesters', { email: 'x@client.local', name: 'X' })).statusCode).toBe(403);
    });
  });

  describe('visibilité et liste', () => {
    it('cantonne l’utilisateur externe à ses propres tickets', async () => {
      const alice = await actor(ctx, 'EXTERNAL_USER');
      const bob = await actor(ctx, 'EXTERNAL_USER');
      const { id } = (await alice.post('/tickets', base)).json();
      await bob.post('/tickets', base);

      expect((await bob.get(`/tickets/${id}`)).statusCode).toBe(404);
      const list = (await alice.get('/tickets')).json();
      expect(list.total).toBe(1);
      expect(list.items[0].id).toBe(id);
    });

    it('filtre, recherche et pagine', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      await agent.post('/tickets', { ...base, impact: 'ORGANIZATION', urgency: 'CRITICAL' });
      await agent.post('/tickets', { subject: 'Facture en double', description: 'Deux prélèvements.', component: 'BILLING' });
      await agent.post('/tickets', { subject: 'Question export', description: 'Comment exporter ?' });

      expect((await agent.get('/tickets?priority=P0,P1')).json().total).toBe(1);
      expect((await agent.get('/tickets?component=BILLING')).json().total).toBe(1);
      expect((await agent.get('/tickets?q=FACTURE')).json().total).toBe(1);

      const page = (await agent.get('/tickets?pageSize=2&page=2')).json();
      expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page.items).toHaveLength(1);

      expect((await agent.get('/tickets?status=INCONNU')).statusCode).toBe(400);
    });
  });

  describe('workflow', () => {
    it('suit le cycle de vie d’un bug et horodate la résolution', async () => {
      const agent = await actor(ctx, 'AGENT_N2');
      const { id } = (await agent.post('/tickets', { ...base, type: 'BUG' })).json();

      for (const status of ['QUALIFYING', 'SENT_TO_DEV', 'IN_PROGRESS', 'IN_QA', 'READY_FOR_RELEASE']) {
        expect((await agent.post(`/tickets/${id}/status`, { status })).statusCode).toBe(200);
      }
      const resolved = (await agent.post(`/tickets/${id}/status`, { status: 'RESOLVED' })).json();
      expect(resolved.resolvedAt).not.toBeNull();

      const reopened = (await agent.post(`/tickets/${id}/status`, { status: 'QUALIFYING' })).json();
      expect(reopened.resolvedAt).toBeNull();
    });

    it('refuse une transition hors workflow', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await agent.post('/tickets', base)).json();
      const res = await agent.post(`/tickets/${id}/status`, { status: 'IN_QA' });
      expect(res.statusCode).toBe(409);
      expect((await agent.get(`/tickets/${id}`)).json().status).toBe('NEW');
    });

    it('fige un ticket clôturé', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await agent.post('/tickets', base)).json();
      const closed = (await agent.post(`/tickets/${id}/status`, { status: 'CLOSED' })).json();
      expect(closed.closedAt).not.toBeNull();
      expect((await agent.patch(`/tickets/${id}`, { urgency: 'HIGH' })).statusCode).toBe(409);
      expect((await agent.post(`/tickets/${id}/comments`, { body: 'encore ?' })).statusCode).toBe(409);
    });

    it('interdit à l’utilisateur externe de changer le statut', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const { id } = (await client.post('/tickets', base)).json();
      expect((await client.post(`/tickets/${id}/status`, { status: 'CLOSED' })).statusCode).toBe(403);
    });
  });

  describe('commentaires', () => {
    it('masque les notes internes à l’utilisateur externe', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await client.post('/tickets', base)).json();

      await agent.post(`/tickets/${id}/comments`, { body: 'Piste : cache Redis', isInternal: true });
      await agent.post(`/tickets/${id}/comments`, { body: 'Nous analysons le problème.' });

      expect((await agent.get(`/tickets/${id}/comments`)).json()).toHaveLength(2);
      const visible = (await client.get(`/tickets/${id}/comments`)).json();
      expect(visible).toHaveLength(1);
      expect(visible[0].body).toBe('Nous analysons le problème.');

      expect((await client.post(`/tickets/${id}/comments`, { body: 'x', isInternal: true })).statusCode).toBe(403);
    });

    it('horodate la première réponse publique du support uniquement', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await client.post('/tickets', base)).json();

      await client.post(`/tickets/${id}/comments`, { body: 'Des nouvelles ?' });
      await agent.post(`/tickets/${id}/comments`, { body: 'note', isInternal: true });
      expect((await agent.get(`/tickets/${id}`)).json().firstResponseAt).toBeNull();

      const reply = (await agent.post(`/tickets/${id}/comments`, { body: 'Bonjour, nous regardons.' })).json();
      const ticket = (await agent.get(`/tickets/${id}`)).json();
      expect(ticket.firstResponseAt).toBe(reply.createdAt);

      await agent.post(`/tickets/${id}/comments`, { body: 'Corrigé.' });
      expect((await agent.get(`/tickets/${id}`)).json().firstResponseAt).toBe(reply.createdAt);
    });

    it('n’expose pas le journal d’audit à l’utilisateur externe', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const { id } = (await client.post('/tickets', base)).json();
      expect((await client.get(`/tickets/${id}/audit`)).statusCode).toBe(403);
    });
  });
});
