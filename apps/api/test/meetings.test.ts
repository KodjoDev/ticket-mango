import { actor, describeDb, resetDb, setup, teardown, type TestContext } from './helpers';

describeDb('rendez-vous', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await setup();
  });
  afterAll(() => teardown(ctx));
  beforeEach(() => resetDb(ctx.prisma));

  const inDays = (days: number, hour = 14) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  async function scenario() {
    const client = await actor(ctx, 'EXTERNAL_USER');
    const agent = await actor(ctx, 'AGENT_N1');
    const dev = await actor(ctx, 'DEVELOPER');
    const { id } = (await client.post('/tickets', { subject: 'Export KO', description: 'Le CSV est vide.' })).json();
    return { client, agent, dev, ticketId: id as number };
  }

  it('fixe un rendez-vous et obtient un lien Meet (mode démo)', async () => {
    const { agent, dev, ticketId } = await scenario();
    const res = await agent.post(`/tickets/${ticketId}/meetings`, {
      mode: 'direct',
      durationMinutes: 30,
      slots: [inDays(2)],
      developerIds: [dev.user.id],
    });
    expect(res.statusCode).toBe(201);
    const meeting = res.json();
    expect(meeting).toMatchObject({ status: 'SCHEDULED', provider: 'demo', bookingUrl: null, durationMinutes: 30 });
    expect(meeting.meetUrl).toMatch(/^https:\/\/meet\.demo\.invalid\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect(meeting.participants.map((p: { id: string }) => p.id)).toContain(dev.user.id);
    expect(meeting.title).toBe(`Ticket #${ticketId} – Export KO`);
  });

  it('valide les créneaux et les participants', async () => {
    const { agent, client, ticketId } = await scenario();
    const post = (body: object) => agent.post(`/tickets/${ticketId}/meetings`, { durationMinutes: 30, developerIds: [], ...body });
    expect((await post({ mode: 'direct', slots: [inDays(-1)] })).statusCode).toBe(400);
    expect((await post({ mode: 'direct', slots: [inDays(1), inDays(2)] })).statusCode).toBe(400);
    expect((await post({ mode: 'proposal', slots: [inDays(1)] })).statusCode).toBe(400);
    expect((await post({ mode: 'direct', slots: [inDays(1)], developerIds: [client.user.id] })).statusCode).toBe(400);
  });

  it('réserve la planification au support', async () => {
    const { client, dev, ticketId } = await scenario();
    const body = { mode: 'direct', durationMinutes: 30, slots: [inDays(1)], developerIds: [] };
    expect((await client.post(`/tickets/${ticketId}/meetings`, body)).statusCode).toBe(403);
    expect((await dev.post(`/tickets/${ticketId}/meetings`, body)).statusCode).toBe(403);
    expect((await dev.get(`/tickets/${ticketId}/meetings`)).statusCode).toBe(200);
  });

  it('laisse le demandeur choisir un créneau sur la page publique', async () => {
    const { agent, dev, client, ticketId } = await scenario();
    const proposal = (
      await agent.post(`/tickets/${ticketId}/meetings`, {
        mode: 'proposal',
        durationMinutes: 45,
        slots: [inDays(3), inDays(1), inDays(2)],
        developerIds: [dev.user.id],
      })
    ).json();
    expect(proposal.status).toBe('PROPOSED');
    expect(proposal.meetUrl).toBeNull();
    const token = proposal.bookingUrl.split('/book/')[1];

    // Vue publique, sans session ni adresse email.
    const page = await ctx.app.inject({ method: 'GET', url: `/public/bookings/${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).not.toContain('@test.local');
    const { slots } = page.json();
    expect(slots.map((s: { startsAt: string }) => s.startsAt)).toEqual([inDays(1), inDays(2), inDays(3)]);

    const booked = await ctx.app.inject({ method: 'POST', url: `/public/bookings/${token}`, payload: { slotId: slots[1].id } });
    expect(booked.statusCode).toBe(200);
    expect(booked.json()).toMatchObject({ status: 'SCHEDULED', startsAt: inDays(2) });
    expect(booked.json().meetUrl).toMatch(/meet\.demo\.invalid/);

    // Un second choix est refusé.
    const again = await ctx.app.inject({ method: 'POST', url: `/public/bookings/${token}`, payload: { slotId: slots[0].id } });
    expect(again.statusCode).toBe(409);

    // L'invitation est publiée automatiquement sur le ticket, visible du demandeur.
    const comments = (await client.get(`/tickets/${ticketId}/comments`)).json();
    expect(comments.at(-1).body).toContain(booked.json().meetUrl);
    expect(comments.at(-1).author.id).toBe(agent.user.id);
  });

  it('rejette un jeton inconnu', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/public/bookings/inconnu-inconnu-inconnu' });
    expect(res.statusCode).toBe(404);
  });

  it('annule un rendez-vous et ferme la réservation', async () => {
    const { agent, ticketId } = await scenario();
    const proposal = (
      await agent.post(`/tickets/${ticketId}/meetings`, { mode: 'proposal', durationMinutes: 30, slots: [inDays(1), inDays(2)] })
    ).json();
    const token = proposal.bookingUrl.split('/book/')[1];
    const cancelled = await agent.post(`/tickets/${ticketId}/meetings/${proposal.id}/cancel`);
    expect(cancelled.json().status).toBe('CANCELLED');

    const { slots } = (await ctx.app.inject({ method: 'GET', url: `/public/bookings/${token}` })).json();
    expect(slots).toEqual([]);
    const audit = (await agent.get(`/tickets/${ticketId}/audit`)).json();
    expect(audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['meeting.proposed', 'meeting.cancelled']));
  });

  it('liste les développeurs invitables', async () => {
    const { agent, dev } = await scenario();
    expect((await agent.get('/developers')).json()).toEqual([{ id: dev.user.id, name: 'DEVELOPER' }]);
  });
});
