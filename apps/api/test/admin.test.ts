import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('administration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(() => resetDb(ctx.prisma));

  const base = { subject: 'Application mobile plantée', description: 'Crash au démarrage.' };
  type Option = { id: string; field: string; key: string; label: string; position: number; isActive: boolean };
  const options = async (who: Awaited<ReturnType<typeof actor>>, field: string): Promise<Option[]> =>
    (await who.get('/config')).json().options.filter((o: Option) => o.field === field);

  it('réserve l’administration à l’administrateur', async () => {
    const n2 = await actor(ctx, 'AGENT_N2');
    expect((await n2.post('/admin/tags', { name: 'VIP', color: '#cc3340' })).statusCode).toBe(403);
    expect((await n2.get('/config')).statusCode).toBe(200);
  });

  describe('listes de qualification', () => {
    it('ajoute une valeur utilisable aussitôt sur un ticket', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const res = await admin.post('/admin/options', { field: 'COMPONENT', key: 'MOBILE_APP', label: 'Application mobile' });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ position: 6, isActive: true, isSystem: false });

      const ticket = await admin.post('/tickets', { ...base, component: 'MOBILE_APP' });
      expect(ticket.json().component).toBe('MOBILE_APP');
      expect((await admin.post('/tickets', { ...base, component: 'INCONNU' })).statusCode).toBe(400);
    });

    it('archive une valeur : interdite sur un nouveau ticket, conservée sur les anciens', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const { id: optionId } = (await admin.post('/admin/options', { field: 'COMPONENT', key: 'LEGACY', label: 'Ancien' })).json();
      const { id: ticketId } = (await admin.post('/tickets', { ...base, component: 'LEGACY' })).json();

      expect((await admin.patch(`/admin/options/${optionId}`, { isActive: false })).statusCode).toBe(200);
      expect((await admin.post('/tickets', { ...base, component: 'LEGACY' })).statusCode).toBe(400);
      // Le ticket existant garde sa valeur et reste modifiable.
      const updated = await admin.patch(`/tickets/${ticketId}`, { urgency: 'HIGH', component: 'LEGACY' });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().component).toBe('LEGACY');
    });

    it('refuse de supprimer une valeur utilisée, accepte sinon', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const used = (await admin.post('/admin/options', { field: 'ENVIRONMENT', key: 'DEMO', label: 'Démo' })).json();
      const unused = (await admin.post('/admin/options', { field: 'ENVIRONMENT', key: 'SANDBOX', label: 'Bac à sable' })).json();
      await admin.post('/tickets', { ...base, environment: 'DEMO' });

      expect((await admin.del(`/admin/options/${used.id}`)).statusCode).toBe(409);
      expect((await admin.del(`/admin/options/${unused.id}`)).statusCode).toBe(204);
    });

    it('protège les types système mais permet de les renommer', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const bug = (await options(admin, 'TYPE')).find((o) => o.key === 'BUG')!;
      expect((await admin.patch(`/admin/options/${bug.id}`, { isActive: false })).statusCode).toBe(400);
      expect((await admin.patch(`/admin/options/${bug.id}`, { label: 'Anomalie' })).json().label).toBe('Anomalie');
      await ctx.prisma.fieldOption.update({ where: { id: bug.id }, data: { label: 'Bug / Incident technique' } });
    });

    it('réordonne les valeurs d’une liste', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const ids = (await options(admin, 'ENVIRONMENT')).map((o) => o.id).reverse();
      expect((await admin.put('/admin/options/order', { field: 'ENVIRONMENT', ids })).statusCode).toBe(200);
      expect((await options(admin, 'ENVIRONMENT')).map((o) => o.key)).toEqual(['ACCEPTANCE', 'STAGING', 'PRODUCTION']);
    });

    it('trace les actions d’administration dans le journal d’audit', async () => {
      const admin = await actor(ctx, 'ADMIN');
      await admin.post('/admin/options', { field: 'TYPE', key: 'SECURITY', label: 'Sécurité' });
      const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'admin.option.created' } });
      expect(log).toMatchObject({ actorId: admin.user.id, ticketId: null });
    });
  });

  describe('matrice de priorité', () => {
    it('s’applique aux nouveaux tickets et refuse une matrice incomplète', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const { priorityMatrix } = (await admin.get('/config')).json();
      priorityMatrix.INDIVIDUAL.MEDIUM = 'P2';

      const put = (payload: object) => admin.put('/admin/priority-matrix', payload);
      expect((await put({ INDIVIDUAL: priorityMatrix.INDIVIDUAL })).statusCode).toBe(400);
      expect((await put(priorityMatrix)).statusCode).toBe(200);

      expect((await admin.post('/tickets', base)).json().priority).toBe('P2');
      expect((await admin.get('/config')).json().priorityMatrix.INDIVIDUAL.MEDIUM).toBe('P2');
    });
  });

  describe('mise en page', () => {
    it('enregistre l’ordre et la visibilité des champs du ticket', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const layout = (await admin.get('/config')).json().ticketForm.reverse();
      layout[0].visible = false;
      const res = await admin.put('/admin/layout/ticket-form', layout);
      expect(res.statusCode).toBe(200);
      expect((await admin.get('/config')).json().ticketForm).toEqual(layout);
    });

    it('exige chaque élément une fois et garde la colonne Sujet visible', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const columns = (await admin.get('/config')).json().listColumns;
      const put = (payload: object) => admin.put('/admin/layout/list-columns', payload);
      expect((await put(columns.slice(1))).statusCode).toBe(400);
      expect(
        (await put(columns.map((c: { key: string }) => ({ ...c, visible: c.key !== 'subject' })))).statusCode,
      ).toBe(400);
    });
  });

  describe('tags', () => {
    it('applique des tags, filtre la liste et journalise le changement', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const agent = await actor(ctx, 'AGENT_N1');
      const vip = (await admin.post('/admin/tags', { name: 'VIP', color: '#cc3340' })).json();
      const mobile = (await admin.post('/admin/tags', { name: 'Mobile', color: '#1f73b7' })).json();
      const { id } = (await agent.post('/tickets', base)).json();
      await agent.post('/tickets', { ...base, subject: 'Autre' });

      const res = await agent.patch(`/tickets/${id}`, { tagIds: [vip.id, mobile.id] });
      expect(res.json().tags.map((t: { name: string }) => t.name)).toEqual(['Mobile', 'VIP']);

      const filtered = (await agent.get(`/tickets?tagId=${vip.id}`)).json();
      expect(filtered.total).toBe(1);
      expect(filtered.items[0].id).toBe(id);

      const audit = (await agent.get(`/tickets/${id}/audit`)).json();
      expect(audit.at(-1).changes.tags).toEqual({ from: [], to: ['Mobile', 'VIP'] });
    });

    it('interdit d’appliquer un tag archivé et de supprimer un tag utilisé', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const tag = (await admin.post('/admin/tags', { name: 'Ancien', color: '#5c6970' })).json();
      const { id } = (await admin.post('/tickets', { ...base, tagIds: [tag.id] })).json();
      await admin.patch(`/admin/tags/${tag.id}`, { isActive: false });

      expect((await admin.post('/tickets', { ...base, tagIds: [tag.id] })).statusCode).toBe(400);
      // Le ticket qui porte déjà le tag peut être modifié sans le perdre.
      expect((await admin.patch(`/tickets/${id}`, { tagIds: [tag.id], urgency: 'LOW' })).statusCode).toBe(200);
      expect((await admin.del(`/admin/tags/${tag.id}`)).statusCode).toBe(409);
    });

    it('refuse à l’utilisateur externe de taguer', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const client = await actor(ctx, 'EXTERNAL_USER');
      const tag = (await admin.post('/admin/tags', { name: 'VIP', color: '#cc3340' })).json();
      expect((await client.post('/tickets', { ...base, tagIds: [tag.id] })).statusCode).toBe(400);
    });
  });

  describe('vues', () => {
    it('compte les tickets de chaque vue pour l’agent connecté', async () => {
      const admin = await actor(ctx, 'ADMIN');
      const agent = await actor(ctx, 'AGENT_N1');
      await admin.post('/admin/views', { name: 'Mes tickets', filters: { status: 'open', assignee: 'me' } });
      await admin.post('/admin/views', { name: 'Non assignés', filters: { status: 'open', assignee: 'none' } });
      await agent.post('/tickets', { ...base, assigneeId: agent.user.id });
      await agent.post('/tickets', base);
      await agent.post('/tickets', base);

      const views = (await agent.get('/views')).json();
      expect(views.map((v: { name: string; count: number }) => [v.name, v.count])).toEqual([
        ['Mes tickets', 1],
        ['Non assignés', 2],
      ]);
    });

    it('valide les filtres et réordonne les vues', async () => {
      const admin = await actor(ctx, 'ADMIN');
      expect((await admin.post('/admin/views', { name: 'X', filters: { status: 'INCONNU' } })).statusCode).toBe(400);
      const a = (await admin.post('/admin/views', { name: 'A', filters: {} })).json();
      const b = (await admin.post('/admin/views', { name: 'B', filters: {} })).json();
      const res = await admin.put('/admin/views/order', { ids: [b.id, a.id] });
      expect(res.json().map((v: { name: string }) => v.name)).toEqual(['B', 'A']);
    });

    it('n’expose pas les vues à l’utilisateur externe', async () => {
      const client = await actor(ctx, 'EXTERNAL_USER');
      expect((await client.get('/views')).statusCode).toBe(403);
    });
  });
});
