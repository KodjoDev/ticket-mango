import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('intégrations développeurs', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(async () => {
    await resetDb(ctx.prisma);
    ctx.devCalls.length = 0;
  });

  const jiraIssue = (status: string, fixVersion?: string) => ({
    key: 'APP-12',
    fields: { summary: 'Erreur 500', status: { name: status }, fixVersions: fixVersion ? [{ name: fixVersion }] : [] },
  });

  async function setupJira() {
    const admin = await actor(ctx, 'ADMIN');
    const agent = await actor(ctx, 'AGENT_N1');
    const created = await admin.post('/admin/dev-integrations', {
      provider: 'JIRA',
      name: 'Jira produit',
      baseUrl: 'https://acme.atlassian.net',
      account: 'bot@acme.com',
      token: 'jeton-secret',
      project: 'APP',
    });
    expect(created.statusCode).toBe(201);
    const ticket = (await agent.post('/tickets', { subject: 'Erreur 500', description: 'Impossible de se connecter.', type: 'BUG' })).json();
    return { admin, agent, integration: created.json(), ticket };
  }

  it('ne renvoie jamais le jeton et réserve l’administration à settings:manage', async () => {
    const { admin, agent, integration } = await setupJira();
    expect(integration).toMatchObject({ hasToken: true, provider: 'JIRA', statusMap: expect.objectContaining({ done: 'READY_FOR_RELEASE' }) });
    expect(JSON.stringify(integration)).not.toContain('jeton-secret');
    expect(integration.webhookUrl).toMatch(/\/inbound\/dev\/[0-9a-f]{64}$/);
    expect((await admin.post('/admin/dev-integrations', { provider: 'JIRA', name: 'x', project: 'APP', baseUrl: 'http://insecure.local' })).statusCode).toBe(400);
    expect((await agent.get('/admin/dev-integrations')).statusCode).toBe(403);
  });

  it('crée l’issue Jira depuis le ticket, le passe aux développeurs et journalise le lien', async () => {
    const { agent, integration, ticket } = await setupJira();
    ctx.respond.current = (url, method) => (method === 'POST' ? { key: 'APP-12' } : jiraIssue('To Do'));

    const res = await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ externalKey: 'APP-12', url: 'https://acme.atlassian.net/browse/APP-12' });

    const [post] = ctx.devCalls;
    expect(post).toMatchObject({ url: 'https://acme.atlassian.net/rest/api/3/issue', method: 'POST' });
    expect(post!.body).toMatchObject({ fields: { project: { key: 'APP' }, issuetype: { name: 'Bug' } } });

    const detail = (await agent.get(`/tickets/${ticket.id}`)).json();
    expect(detail.status).toBe('SENT_TO_DEV');
    expect(detail.devLinks).toEqual([expect.objectContaining({ externalKey: 'APP-12', externalStatus: 'To Do' })]);
    const audit = (await agent.get(`/tickets/${ticket.id}/audit`)).json();
    expect(audit.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['ticket.dev_linked', 'ticket.status_changed']),
    );
  });

  it('refuse l’issue d’un autre projet et une seconde liaison identique', async () => {
    const { agent, integration, ticket } = await setupJira();
    ctx.respond.current = () => jiraIssue('To Do');
    expect((await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id, reference: 'OTHER-3' })).statusCode).toBe(400);
    expect((await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id, reference: 'APP-12' })).statusCode).toBe(201);
    expect((await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id, reference: 'APP-12' })).statusCode).toBe(409);
  });

  it('synchronise statut et version de correction depuis le webhook Jira', async () => {
    const { agent, integration, ticket } = await setupJira();
    ctx.respond.current = () => jiraIssue('To Do');
    await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id, reference: 'APP-12' });
    const hook = integration.webhookUrl.replace(/^.*\/inbound/, '/inbound');

    const progress = await ctx.app.inject({ method: 'POST', url: hook, payload: { webhookEvent: 'jira:issue_updated', issue: jiraIssue('In Progress') } });
    expect(progress.json()).toEqual({ status: 'ok', tickets: 1 });
    expect((await agent.get(`/tickets/${ticket.id}`)).json().status).toBe('IN_PROGRESS');

    await ctx.app.inject({ method: 'POST', url: hook, payload: { issue: jiraIssue('Done', 'v2.4.1') } });
    const detail = (await agent.get(`/tickets/${ticket.id}`)).json();
    expect(detail).toMatchObject({ status: 'READY_FOR_RELEASE', fixedInVersion: 'v2.4.1' });
    expect(detail.devLinks[0]).toMatchObject({ externalStatus: 'Done', fixVersion: 'v2.4.1' });

    // Statut inconnu : le lien est mis à jour, pas le ticket.
    await ctx.app.inject({ method: 'POST', url: hook, payload: { issue: jiraIssue('Bizarre', 'v2.4.1') } });
    expect((await agent.get(`/tickets/${ticket.id}`)).json().status).toBe('READY_FOR_RELEASE');
  });

  it('ne touche jamais un ticket résolu et ignore les jetons ou événements inconnus', async () => {
    const { agent, integration, ticket } = await setupJira();
    ctx.respond.current = () => jiraIssue('To Do');
    await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id, reference: 'APP-12' });
    // SENT_TO_DEV → QUALIFYING → RESOLVED
    await agent.post(`/tickets/${ticket.id}/status`, { status: 'QUALIFYING' });
    await agent.post(`/tickets/${ticket.id}/status`, { status: 'RESOLVED' });
    const hook = integration.webhookUrl.replace(/^.*\/inbound/, '/inbound');
    await ctx.app.inject({ method: 'POST', url: hook, payload: { issue: jiraIssue('In Progress') } });
    expect((await agent.get(`/tickets/${ticket.id}`)).json().status).toBe('RESOLVED');

    expect((await ctx.app.inject({ method: 'POST', url: hook, payload: { ping: true } })).json().status).toBe('ignored');
    expect((await ctx.app.inject({ method: 'POST', url: `/inbound/dev/${'0'.repeat(64)}`, payload: {} })).statusCode).toBe(404);
  });

  it('gère GitHub : création, étiquette de statut, jalon comme version de correction', async () => {
    const admin = await actor(ctx, 'ADMIN');
    const agent = await actor(ctx, 'AGENT_N1');
    const integration = (
      await admin.post('/admin/dev-integrations', { provider: 'GITHUB', name: 'GitHub', token: 'ghp_x', project: 'acme/app' })
    ).json();
    const ticket = (await agent.post('/tickets', { subject: 'Bug', description: 'Description' })).json();
    const issue = (state: string, labels: string[] = [], milestone?: string) => ({
      number: 34,
      title: 'Bug',
      state,
      html_url: 'https://github.com/acme/app/issues/34',
      labels: labels.map((name) => ({ name })),
      milestone: milestone ? { title: milestone } : null,
    });
    ctx.respond.current = () => issue('open');

    await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id });
    expect(ctx.devCalls[0]).toMatchObject({ url: 'https://api.github.com/repos/acme/app/issues', method: 'POST' });
    expect((await agent.get(`/tickets/${ticket.id}`)).json().devLinks[0].externalKey).toBe('acme/app#34');

    const hook = integration.webhookUrl.replace(/^.*\/inbound/, '/inbound');
    const send = (payload: object, event = 'issues') =>
      ctx.app.inject({ method: 'POST', url: hook, headers: { 'x-github-event': event }, payload });
    await send({ action: 'labeled', issue: issue('open', ['in review']), repository: { full_name: 'acme/app' } });
    expect((await agent.get(`/tickets/${ticket.id}`)).json().status).toBe('IN_QA');

    await send({ action: 'closed', issue: issue('closed', [], 'v2.4.1'), repository: { full_name: 'acme/app' } });
    expect((await agent.get(`/tickets/${ticket.id}`)).json()).toMatchObject({ status: 'READY_FOR_RELEASE', fixedInVersion: 'v2.4.1' });

    // Autre dépôt ou autre événement : ignoré.
    expect((await send({ issue: issue('open'), repository: { full_name: 'autre/depot' } })).json().status).toBe('ignored');
    expect((await send({ issue: issue('open'), repository: { full_name: 'acme/app' } }, 'push')).json().status).toBe('ignored');
  });

  it('cache les liens aux clients, retire un lien et efface la version de correction', async () => {
    const { agent, integration, ticket } = await setupJira();
    ctx.respond.current = () => jiraIssue('Done', 'v1.0');
    const client = await actor(ctx, 'EXTERNAL_USER');
    const own = (await client.post('/tickets', { subject: 'Mon bug', description: 'Détail' })).json();
    expect((await client.post(`/dev/tickets/${own.id}/links`, { integrationId: integration.id, reference: 'APP-12' })).statusCode).toBe(403);

    await agent.post(`/dev/tickets/${ticket.id}/links`, { integrationId: integration.id, reference: 'APP-12' });
    const [link] = (await agent.get(`/tickets/${ticket.id}`)).json().devLinks;
    expect((await agent.del(`/dev/tickets/${ticket.id}/links/${link.id}`)).statusCode).toBe(204);
    expect((await agent.get(`/tickets/${ticket.id}`)).json()).toMatchObject({ devLinks: [], fixedInVersion: null });
  });
});
