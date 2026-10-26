import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('champs personnalisés', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  async function setupFields() {
    const admin = await actor(ctx, 'ADMIN');
    const mk = async (body: object) => {
      const res = await admin.post('/admin/custom-fields', body);
      expect(res.statusCode).toBe(201);
      return res.json();
    };
    await mk({ key: 'client_id', label: 'N° client', kind: 'TEXT', required: true, forRequester: true });
    await mk({ key: 'severity_level', label: 'Niveau', kind: 'SELECT', options: ['bas', 'haut'] });
    await mk({ key: 'cost', label: 'Coût (€)', kind: 'NUMBER' });
    return admin;
  }

  it('administre les champs : validations, clé unique et droits', async () => {
    const admin = await setupFields();
    const n1 = await actor(ctx, 'AGENT_N1');
    expect((await n1.post('/admin/custom-fields', { key: 'abc', label: 'x', kind: 'TEXT' })).statusCode).toBe(403);
    expect((await admin.post('/admin/custom-fields', { key: 'Bad Key', label: 'x', kind: 'TEXT' })).statusCode).toBe(400);
    expect((await admin.post('/admin/custom-fields', { key: 'client_id', label: 'x', kind: 'TEXT' })).statusCode).toBe(409);
    expect((await admin.post('/admin/custom-fields', { key: 'liste', label: 'x', kind: 'SELECT' })).statusCode).toBe(400);
    expect((await admin.post('/admin/custom-fields', { key: 'coche', label: 'x', kind: 'CHECKBOX', required: true })).statusCode).toBe(400);

    const fields = (await admin.get('/admin/custom-fields')).json();
    expect(fields.map((f: { key: string }) => f.key)).toEqual(['client_id', 'severity_level', 'cost']);
    const reordered = await admin.put('/admin/custom-fields/order', { ids: [fields[2].id, fields[0].id, fields[1].id] });
    expect(reordered.json().map((f: { key: string }) => f.key)).toEqual(['cost', 'client_id', 'severity_level']);
    // La clé et le type ne se modifient pas.
    expect((await admin.patch(`/admin/custom-fields/${fields[0].id}`, { key: 'autre' })).statusCode).toBe(400);
  });

  it('exige les champs obligatoires à la création et valide les types', async () => {
    await setupFields();
    const n1 = await actor(ctx, 'AGENT_N1');
    const base = { subject: 'Test', description: 'Description.' };
    expect((await n1.post('/tickets', base)).statusCode).toBe(400);
    expect((await n1.post('/tickets', { ...base, customValues: { client_id: 'C-1', cost: 'cher' } })).statusCode).toBe(400);
    expect((await n1.post('/tickets', { ...base, customValues: { client_id: 'C-1', severity_level: 'moyen' } })).statusCode).toBe(400);
    expect((await n1.post('/tickets', { ...base, customValues: { client_id: 'C-1', inconnu: 'x' } })).statusCode).toBe(400);

    const res = await n1.post('/tickets', { ...base, customValues: { client_id: ' C-1 ', severity_level: 'haut', cost: 12.5 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().customValues).toEqual({ client_id: 'C-1', severity_level: 'haut', cost: 12.5 });
  });

  it('modifie les champs fournis seulement et journalise sans exposer les textes', async () => {
    await setupFields();
    const n1 = await actor(ctx, 'AGENT_N1');
    const t = (await n1.post('/tickets', { subject: 'Test', description: 'D.', customValues: { client_id: 'SECRET-1', cost: 10 } })).json();

    const res = await n1.patch(`/tickets/${t.id}`, { customValues: { cost: 20, severity_level: 'bas' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().customValues).toEqual({ client_id: 'SECRET-1', cost: 20, severity_level: 'bas' });
    expect((await n1.patch(`/tickets/${t.id}`, { customValues: { client_id: '' } })).statusCode).toBe(400);

    const audit = await ctx.prisma.auditLog.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: 'asc' } });
    const json = JSON.stringify(audit.map((a) => a.changes));
    expect(json).toContain('custom.cost');
    expect(json).not.toContain('SECRET-1');
  });

  it('limite le demandeur aux champs qui lui sont ouverts', async () => {
    await setupFields();
    const client = await actor(ctx, 'EXTERNAL_USER');
    const n1 = await actor(ctx, 'AGENT_N1');

    const config = (await client.get('/config')).json();
    expect(config.customFields.map((f: { key: string }) => f.key)).toEqual(['client_id']);
    expect((await n1.get('/config')).json().customFields).toHaveLength(3);

    const base = { subject: 'Aide', description: 'Besoin.' };
    expect((await client.post('/tickets', base)).statusCode).toBe(400);
    expect((await client.post('/tickets', { ...base, customValues: { client_id: 'C-9', cost: 5 } })).statusCode).toBe(400);
    const created = await client.post('/tickets', { ...base, customValues: { client_id: 'C-9' } });
    expect(created.statusCode).toBe(201);

    // Le support complète un champ réservé ; le demandeur ne le voit pas.
    await n1.patch(`/tickets/${created.json().id}`, { customValues: { cost: 99 } });
    const detail = (await client.get(`/tickets/${created.json().id}`)).json();
    expect(detail.customValues).toEqual({ client_id: 'C-9' });
    const list = (await client.get('/tickets')).json();
    expect(JSON.stringify(list)).not.toContain('"cost"');
    expect((await client.patch(`/tickets/${created.json().id}`, { customValues: { client_id: 'X' } })).statusCode).toBe(403);
  });

  it('archive un champ : plus saisissable, valeurs conservées', async () => {
    const admin = await setupFields();
    const n1 = await actor(ctx, 'AGENT_N1');
    const t = (await n1.post('/tickets', { subject: 'Test', description: 'D.', customValues: { client_id: 'C-1', cost: 1 } })).json();
    const cost = (await admin.get('/admin/custom-fields')).json().find((f: { key: string }) => f.key === 'cost');
    await admin.patch(`/admin/custom-fields/${cost.id}`, { isActive: false });

    expect((await n1.patch(`/tickets/${t.id}`, { customValues: { cost: 2 } })).statusCode).toBe(400);
    expect((await n1.get(`/tickets/${t.id}`)).json().customValues).toMatchObject({ cost: 1 });
    expect((await n1.get('/config')).json().customFields.map((f: { key: string }) => f.key)).not.toContain('cost');
  });
});
