import { actor, describeDb, GROUP_IDS, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('routage, SLA et suivi des réponses', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(() => resetDb(ctx.prisma));

  const base = { subject: 'Écran blanc', description: 'Plus rien ne s’affiche.' };
  const addMembers = (groupId: string, ...userIds: string[]) =>
    ctx.prisma.groupMember.createMany({ data: userIds.map((userId) => ({ groupId, userId })) });

  describe('routage', () => {
    it('applique la première règle qui correspond', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const critical = (await agent.post('/tickets', { ...base, impact: 'ORGANIZATION', urgency: 'CRITICAL' })).json();
      const db = (await agent.post('/tickets', { ...base, component: 'DATABASE' })).json();
      const other = (await agent.post('/tickets', base)).json();
      expect(critical.group).toEqual({ id: GROUP_IDS.n2, name: 'Support N2' });
      expect(db.group.name).toBe('DevOps');
      expect(other.group.name).toBe('Support N1');
    });

    it('distribue à tour de rôle dans un groupe en ROUND_ROBIN', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const a = await actor(ctx, 'AGENT_N1');
      const b = await actor(ctx, 'AGENT_N1');
      const reader = await actor(ctx, 'READER');
      await addMembers(GROUP_IDS.n1, a.user.id, b.user.id, reader.user.id);

      const assignees = [];
      for (let i = 0; i < 4; i++) assignees.push((await client.post('/tickets', base)).json().assignee?.id);
      // Alternance entre les deux agents ; le lecteur, sans droit de traitement, n'est jamais servi.
      const [first, second] = assignees;
      expect(new Set([first, second])).toEqual(new Set([a.user.id, b.user.id]));
      expect(assignees).toEqual([first, second, first, second]);

      const notified = await ctx.prisma.notification.count({ where: { userId: first, kind: 'ticket.assigned' } });
      expect(notified).toBe(2);
    });

    it('distribue au moins chargé dans un groupe en LOAD', async () => {
      const agent = await actor(ctx, 'AGENT_N2');
      const busy = await actor(ctx, 'AGENT_N2');
      const idle = await actor(ctx, 'AGENT_N2');
      await addMembers(GROUP_IDS.n2, busy.user.id, idle.user.id);
      await agent.post('/tickets', { ...base, assigneeId: busy.user.id });
      const ticket = (await agent.post('/tickets', { ...base, impact: 'ORGANIZATION', urgency: 'CRITICAL' })).json();
      expect(ticket.assignee.id).toBe(idle.user.id);
    });

    it('laisse la file d’un groupe MANUAL non assignée et respecte un groupe explicite', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      await addMembers(GROUP_IDS.devops, agent.user.id);
      const manual = (await agent.post('/tickets', { ...base, component: 'DATABASE' })).json();
      expect(manual.assignee).toBeNull();
      const explicit = (await agent.post('/tickets', { ...base, component: 'DATABASE', groupId: GROUP_IDS.product })).json();
      expect(explicit.group.name).toBe('Produit / QA');
    });

    it('relance le routage après requalification', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await agent.post('/tickets', base)).json();
      await agent.patch(`/tickets/${id}`, { component: 'DATABASE' });
      const routed = (await agent.post(`/tickets/${id}/route`)).json();
      expect(routed.group.name).toBe('DevOps');
      const audit = (await agent.get(`/tickets/${id}/audit`)).json();
      expect(audit.at(-1)).toMatchObject({ action: 'ticket.routed', changes: { routedTo: 'DevOps' } });
    });

    it('filtre la liste sur les groupes de l’agent', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      await addMembers(GROUP_IDS.devops, agent.user.id);
      await agent.post('/tickets', { ...base, component: 'DATABASE' });
      await agent.post('/tickets', base);
      expect((await agent.get('/tickets?groupId=mine')).json().total).toBe(1);
    });
  });

  describe('SLA', () => {
    it('expose l’état SLA sur chaque ticket', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const ticket = (await agent.post('/tickets', { ...base, impact: 'ORGANIZATION', urgency: 'CRITICAL' })).json();
      expect(ticket.sla).toMatchObject({ calendar: 'ALWAYS', state: 'OK', firstResponse: { targetMinutes: 15, state: 'OK' } });
      expect(ticket.slaState).toBe('OK');
      const list = (await agent.get('/tickets')).json();
      expect(list.items[0].sla.resolution.targetMinutes).toBe(120);
    });

    it('suspend la résolution en attente du client et reprend à sa réponse', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await client.post('/tickets', base)).json();
      await agent.patch(`/tickets/${id}`, { assigneeId: agent.user.id });
      await agent.post(`/tickets/${id}/status`, { status: 'QUALIFYING' });
      await agent.post(`/tickets/${id}/comments`, { body: 'Quel navigateur ?' });
      const waiting = (await agent.post(`/tickets/${id}/status`, { status: 'WAITING_CUSTOMER' })).json();
      expect(waiting.sla.resolution.state).toBe('PAUSED');

      await client.post(`/tickets/${id}/comments`, { body: 'Firefox 140.' });
      const resumed = (await agent.get(`/tickets/${id}`)).json();
      expect(resumed.status).toBe('QUALIFYING');
      expect(resumed.sla.resolution.state).not.toBe('PAUSED');
      const audit = (await agent.get(`/tickets/${id}/audit`)).json();
      expect(audit.find((a: { changes: { auto?: boolean } }) => a.changes?.auto)).toMatchObject({ actor: { id: client.user.id } });
      expect(await ctx.prisma.notification.count({ where: { userId: agent.user.id, kind: 'ticket.customer_replied' } })).toBe(1);
      expect(await ctx.prisma.slaPause.count({ where: { ticketId: id, endedAt: { not: null } } })).toBe(1);
    });

    it('alerte une seule fois par niveau, l’agent assigné et le responsable du groupe', async () => {
      const agent = await actor(ctx, 'AGENT_N2');
      const manager = await actor(ctx, 'AGENT_N2');
      await ctx.prisma.group.update({ where: { id: GROUP_IDS.n2 }, data: { managerId: manager.user.id } });
      const { id } = (
        await agent.post('/tickets', { ...base, impact: 'ORGANIZATION', urgency: 'CRITICAL', assigneeId: agent.user.id })
      ).json();
      const created = (await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } })).createdAt.getTime();

      // 13 min : la première réponse (15 min) est à risque.
      expect((await ctx.app.slaMonitor.run(new Date(created + 13 * 60_000))).alerts).toBe(1);
      expect((await ctx.app.slaMonitor.run(new Date(created + 14 * 60_000))).alerts).toBe(0);
      // 20 min : dépassée.
      await ctx.app.slaMonitor.run(new Date(created + 20 * 60_000));

      const kinds = (userId: string) =>
        ctx.prisma.notification.findMany({ where: { userId, kind: { startsWith: 'sla.' } }, orderBy: { createdAt: 'asc' } });
      expect((await kinds(agent.user.id)).map((n) => n.kind)).toEqual(['sla.warning', 'sla.breached']);
      expect(await kinds(manager.user.id)).toHaveLength(2);
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } })).slaState).toBe('BREACHED');

      const listed = (await agent.get('/tickets?slaState=BREACHED&sort=sla')).json();
      expect(listed.items.map((t: { id: number }) => t.id)).toEqual([id]);
    });

    it('applique une politique SLA administrée et refuse une politique invalide', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const { slaPolicy } = (await admin.get('/config')).json();
      slaPolicy.targets.P4.resolutionMinutes = 5 * 24 * 60;
      expect((await admin.put('/admin/sla-policy', slaPolicy)).statusCode).toBe(200);
      expect((await admin.post('/tickets', base)).json().sla.resolution.targetMinutes).toBe(7200);

      const closedWeek = { ...slaPolicy, businessHours: { ...slaPolicy.businessHours, week: Array(7).fill(null) } };
      expect((await admin.put('/admin/sla-policy', closedWeek)).statusCode).toBe(400);
      expect((await admin.put('/admin/sla-policy', { ...slaPolicy, warningPercent: 120 })).statusCode).toBe(400);
    });
  });

  describe('notifications', () => {
    it('liste, compte et marque comme lues les notifications de l’utilisateur', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const other = await actor(ctx, 'AGENT_N1');
      await other.post('/tickets', { ...base, assigneeId: agent.user.id });
      await other.post('/tickets', { ...base, assigneeId: agent.user.id });

      const { items, unread } = (await agent.get('/notifications')).json();
      expect(unread).toBe(2);
      await agent.post(`/notifications/${items[0].id}/read`);
      expect((await agent.get('/notifications')).json().unread).toBe(1);
      await agent.post('/notifications/read-all');
      expect((await agent.get('/notifications')).json().unread).toBe(0);
      expect((await other.get('/notifications')).json().items).toEqual([]);
    });
  });

  describe('ticket référent', () => {
    it('rattache des tickets à un référent et les liste sur celui-ci', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const referent = (await agent.post('/tickets', { ...base, subject: 'Panne générale' })).json();
      const a = (await agent.post('/tickets', base)).json();
      const b = (await agent.post('/tickets', base)).json();
      await agent.put(`/tickets/${a.id}/parent`, { parentId: referent.id });
      const linked = (await agent.put(`/tickets/${b.id}/parent`, { parentId: referent.id })).json();
      expect(linked.parent).toMatchObject({ id: referent.id, subject: 'Panne générale' });

      const detail = (await agent.get(`/tickets/${referent.id}`)).json();
      expect(detail.childCount).toBe(2);
      expect(detail.children.map((c: { id: number }) => c.id)).toEqual([a.id, b.id]);
      const audit = (await agent.get(`/tickets/${referent.id}/audit`)).json();
      expect(audit.filter((x: { action: string }) => x.action === 'ticket.child_linked')).toHaveLength(2);

      await agent.put(`/tickets/${a.id}/parent`, { parentId: null });
      expect((await agent.get(`/tickets/${referent.id}`)).json().childCount).toBe(1);
    });

    it('n’autorise qu’un niveau et aucune boucle', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      const ref = (await agent.post('/tickets', base)).json();
      const child = (await agent.post('/tickets', base)).json();
      const other = (await agent.post('/tickets', base)).json();
      await agent.put(`/tickets/${child.id}/parent`, { parentId: ref.id });

      expect((await agent.put(`/tickets/${ref.id}/parent`, { parentId: ref.id })).statusCode).toBe(400);
      expect((await agent.put(`/tickets/${other.id}/parent`, { parentId: child.id })).statusCode).toBe(409);
      expect((await agent.put(`/tickets/${ref.id}/parent`, { parentId: other.id })).statusCode).toBe(409);
      expect((await agent.put(`/tickets/${other.id}/parent`, { parentId: 99_999 })).statusCode).toBe(400);
    });

    it('réserve le rattachement au support', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const a = (await client.post('/tickets', base)).json();
      const b = (await client.post('/tickets', base)).json();
      expect((await client.put(`/tickets/${a.id}/parent`, { parentId: b.id })).statusCode).toBe(403);
    });
  });

  describe('réponse client en attente', () => {
    it('signale un ticket dont le demandeur a parlé en dernier', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const agent = await actor(ctx, 'AGENT_N1');
      const { id } = (await client.post('/tickets', base)).json();
      expect((await agent.get(`/tickets/${id}`)).json().awaitingAgent).toBe(true);

      await agent.post(`/tickets/${id}/comments`, { body: 'Note', isInternal: true });
      expect((await agent.get(`/tickets/${id}`)).json().awaitingAgent).toBe(true);

      await agent.post(`/tickets/${id}/comments`, { body: 'Nous regardons.' });
      const replied = (await agent.get(`/tickets/${id}`)).json();
      expect(replied).toMatchObject({ awaitingAgent: false });
      expect(replied.lastAgentReplyAt).not.toBeNull();

      await client.post(`/tickets/${id}/comments`, { body: 'Toujours en panne.' });
      expect((await agent.get('/tickets?awaitingAgent=true')).json().items.map((t: { id: number }) => t.id)).toEqual([id]);
    });

    it('ne signale pas un ticket ouvert par le support, ni un ticket résolu', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      const agent = await actor(ctx, 'AGENT_N1');
      const internal = (await agent.post('/tickets', base)).json();
      expect(internal.awaitingAgent).toBe(false);
      const { id } = (await client.post('/tickets', base)).json();
      await agent.post(`/tickets/${id}/status`, { status: 'RESOLVED' });
      expect((await agent.get(`/tickets/${id}`)).json().awaitingAgent).toBe(false);
    });

    it('retrouve un ticket par son numéro dans la recherche', async () => {
      const agent = await actor(ctx, 'AGENT_N1');
      await agent.post('/tickets', base);
      const { id } = (await agent.post('/tickets', base)).json();
      expect((await agent.get(`/tickets?q=%23${id}`)).json().items.map((t: { id: number }) => t.id)).toEqual([id]);
    });
  });

  describe('administration des groupes et des règles', () => {
    it('crée un groupe avec ses membres et une règle qui y route', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const agent = await actor(ctx, 'AGENT_N1');
      const group = (
        await admin.post('/admin/groups', { name: 'Facturation', distribution: 'ROUND_ROBIN', memberIds: [agent.user.id] })
      ).json();
      const rules = (await admin.get('/admin/routing-rules')).json();
      const rule = (await admin.post('/admin/routing-rules', { name: 'Factures', conditions: { component: ['BILLING'] }, groupId: group.id })).json();
      // La nouvelle règle passe avant « Par défaut ».
      const order = [...rules.slice(0, -1).map((r: { id: string }) => r.id), rule.id, rules.at(-1).id];
      expect((await admin.put('/admin/routing-rules/order', { ids: order })).statusCode).toBe(200);

      const ticket = (await admin.post('/tickets', { ...base, component: 'BILLING' })).json();
      expect(ticket).toMatchObject({ group: { name: 'Facturation' }, assignee: { id: agent.user.id } });
      const listed = (await admin.get('/admin/groups')).json().find((g: { id: string }) => g.id === group.id);
      expect(listed).toMatchObject({ ticketCount: 1, members: [{ id: agent.user.id }] });
      expect((await admin.del(`/admin/groups/${group.id}`)).statusCode).toBe(400);
    });
  });
});
