/**
 * US-11 — Coleta e Vinculação de CSAT/NPS ao Ticket
 * Tests covering all 6 acceptance criteria scenarios (BDD)
 */
process.env.SQLITE_FILE = ':memory:';
const request = require('supertest');
const app = require('../src/index');
const db = require('../src/db');

beforeEach(() => {
  db.resetDatabase();
});

// Helper: create and fully finalize a ticket, returning the ticket body
async function createFinalizedTicket(queueId = 'csatQ', serviceId = 'svc-01', attendant = 'agent-01') {
  const r = await request(app).post('/tickets').send({ queueId, meta: { serviceId } });
  const id = r.body.id;
  await request(app).post(`/tickets/${id}/call`).send({ guiche: 'G1' });
  await request(app).post(`/tickets/${id}/attend`).send({ attendant });
  await request(app).post(`/tickets/${id}/finalize`).send({ result: { outcome: 'ok' } });
  return r.body;
}

// ─────────────────────────────────────────────────────────
// Cenário 1: Cidadão avalia o atendimento — Caminho Feliz
// ─────────────────────────────────────────────────────────
describe('Cenário 1 — Caminho Feliz: cidadão envia avaliação', () => {
  test('POST /tickets/:id/csat stores rating, comment, ticketId, attendant, serviceId and timestamp', async () => {
    const ticket = await createFinalizedTicket('q1', 'svc-A', 'agente-X');

    const res = await request(app)
      .post(`/tickets/${ticket.id}/csat`)
      .send({ rating: 5, comment: 'Excelente atendimento!', attendant: 'agente-X', serviceId: 'svc-A' });

    expect(res.status).toBe(201);
    expect(res.body.ticketId).toBe(ticket.id);
    expect(res.body.rating).toBe(5);
    expect(res.body.comment).toBe('Excelente atendimento!');
    expect(res.body.attendant).toBe('agente-X');
    expect(res.body.serviceId).toBe('svc-A');
    expect(res.body).toHaveProperty('createdAt');
    expect(res.body.skipped).toBe(false);
    expect(res.body.flagged).toBe(false);
  });

  test('Accepts ratings 1 through 5', async () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      db.resetDatabase();
      const ticket = await createFinalizedTicket();
      const res = await request(app)
        .post(`/tickets/${ticket.id}/csat`)
        .send({ rating });
      expect(res.status).toBe(201);
      expect(res.body.rating).toBe(rating);
    }
  });

  test('Returns 400 for rating out of range (0 or 6)', async () => {
    const ticket = await createFinalizedTicket();

    const r0 = await request(app).post(`/tickets/${ticket.id}/csat`).send({ rating: 0 });
    expect(r0.status).toBe(400);

    const r6 = await request(app).post(`/tickets/${ticket.id}/csat`).send({ rating: 6 });
    expect(r6.status).toBe(400);
  });

  test('Comment is optional — submission without comment succeeds', async () => {
    const ticket = await createFinalizedTicket();
    const res = await request(app).post(`/tickets/${ticket.id}/csat`).send({ rating: 4 });
    expect(res.status).toBe(201);
    expect(res.body.comment).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────
// Cenário 2: Cidadão não avalia (skip / timeout)
// ─────────────────────────────────────────────────────────
describe('Cenário 2 — Skip/Timeout: avaliação não respondida', () => {
  test('POST /tickets/:id/csat with skipped=true records "Não Respondida" without note', async () => {
    const ticket = await createFinalizedTicket();
    const res = await request(app)
      .post(`/tickets/${ticket.id}/csat`)
      .send({ skipped: true });

    expect(res.status).toBe(201);
    expect(res.body.skipped).toBe(true);
    expect(res.body.rating).toBeNull();
    expect(res.body.comment).toBeNull();
    expect(res.body.ticketId).toBe(ticket.id);
  });

  test('Skipped CSAT does not affect ticket status or flow', async () => {
    const ticket = await createFinalizedTicket();
    await request(app).post(`/tickets/${ticket.id}/csat`).send({ skipped: true });

    const ticketCheck = await request(app).get('/tickets').query({ queueId: 'csatQ' });
    const found = ticketCheck.body.find(t => t.id === ticket.id);
    expect(found.status).toBe('finalized');
  });

  test('Returns 404 for non-existent ticket', async () => {
    const res = await request(app).post('/tickets/non-existent/csat').send({ skipped: true });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────
// Cenário 3: Visualização de CSAT pelo gestor por atendente
// ─────────────────────────────────────────────────────────
describe('Cenário 3 — Relatório CSAT por atendente', () => {
  test('GET /csat/stats?attendant returns avg, distribution, responseRate and anonymized comments', async () => {
    const t1 = await createFinalizedTicket('q3', 'svc1', 'atd1');
    const t2 = await createFinalizedTicket('q3', 'svc1', 'atd1');
    const t3 = await createFinalizedTicket('q3', 'svc1', 'atd1');

    await request(app).post(`/tickets/${t1.id}/csat`).send({ rating: 5, comment: 'Ótimo!', attendant: 'atd1', serviceId: 'svc1' });
    await request(app).post(`/tickets/${t2.id}/csat`).send({ rating: 3, comment: 'Razoável', attendant: 'atd1', serviceId: 'svc1' });
    await request(app).post(`/tickets/${t3.id}/csat`).send({ skipped: true, attendant: 'atd1', serviceId: 'svc1' });

    const res = await request(app).get('/csat/stats').query({ attendant: 'atd1' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('avgCsat');
    expect(res.body).toHaveProperty('distribution');
    expect(res.body).toHaveProperty('responseRate');
    expect(res.body).toHaveProperty('comments');
    expect(res.body.total).toBe(3);
    expect(res.body.answered).toBe(2);
    expect(res.body.avgCsat).toBe(4.0); // (5+3)/2
    expect(res.body.distribution[5]).toBe(1);
    expect(res.body.distribution[3]).toBe(1);
    expect(res.body.responseRate).toBe(66.67);
  });

  test('Comments in stats do not expose citizen PII — only ticketId and content', async () => {
    const ticket = await createFinalizedTicket('q3c', 'svc1', 'atd2');
    await request(app).post(`/tickets/${ticket.id}/csat`).send({ rating: 4, comment: 'Bom serviço', attendant: 'atd2', serviceId: 'svc1' });

    const res = await request(app).get('/csat/stats').query({ attendant: 'atd2' });
    expect(res.status).toBe(200);

    const comment = res.body.comments[0];
    expect(comment).toHaveProperty('ticketId');
    expect(comment).toHaveProperty('rating');
    expect(comment).toHaveProperty('comment');
    // must NOT expose any citizen personal data
    expect(comment).not.toHaveProperty('nome');
    expect(comment).not.toHaveProperty('cpf');
    expect(comment).not.toHaveProperty('telefone');
    expect(comment).not.toHaveProperty('meta');
  });

  test('Stats can be filtered by period (from/to)', async () => {
    const t = await createFinalizedTicket('q3d', 'svc1', 'atd3');
    await request(app).post(`/tickets/${t.id}/csat`).send({ rating: 5, attendant: 'atd3', serviceId: 'svc1' });

    const now = new Date();
    const yesterday = new Date(now - 86400000).toISOString();
    const tomorrow = new Date(now.getTime() + 86400000).toISOString();

    const res = await request(app).get('/csat/stats').query({ attendant: 'atd3', from: yesterday, to: tomorrow });
    expect(res.status).toBe(200);
    expect(res.body.answered).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────
// Cenário 4: NPS calculado a nível de serviço
// ─────────────────────────────────────────────────────────
describe('Cenário 4 — NPS por serviço', () => {
  test('GET /csat/nps with < 10 ratings returns null NPS with "Dados insuficientes" message', async () => {
    const t = await createFinalizedTicket('npsQ', 'svc-nps', 'agX');
    await request(app).post(`/tickets/${t.id}/csat`).send({ rating: 5, serviceId: 'svc-nps' });

    const res = await request(app).get('/csat/nps').query({ serviceId: 'svc-nps' });
    expect(res.status).toBe(200);
    expect(res.body.nps).toBeNull();
    expect(res.body.message).toMatch(/insuficientes/i);
    expect(res.body.required).toBe(10);
  });

  test('GET /csat/nps with >= 10 ratings returns valid NPS: (promoters% - detractors%) x 100', async () => {
    // 6 promoters (4-5), 2 neutrals (3), 2 detractors (1-2) → NPS = (6/10 - 2/10) * 100 = 40
    db.resetDatabase();
    const allRatings = [5, 5, 5, 4, 4, 4, 3, 3, 1, 2]; // 6 promoters, 2 neutral, 2 detractors
    for (const rating of allRatings) {
      const t = await createFinalizedTicket('npsQ2', 'svc-nps2', 'ag1');
      await request(app).post(`/tickets/${t.id}/csat`).send({ rating, serviceId: 'svc-nps2' });
    }

    const res = await request(app).get('/csat/nps').query({ serviceId: 'svc-nps2' });
    expect(res.status).toBe(200);
    expect(res.body.nps).toBe(40); // (6/10 - 2/10) * 100 = 40
    expect(res.body.promoters).toBe(6);
    expect(res.body.neutrals).toBe(2);
    expect(res.body.detractors).toBe(2);
    expect(res.body.total).toBe(10);
    expect(res.body.message).toBeNull();
  });

  test('NPS formula: promoters = rating 4-5, detractors = rating 1-2, neutrals = 3', async () => {
    // All promoters: NPS = 100
    db.resetDatabase();
    for (let i = 0; i < 10; i++) {
      const t = await createFinalizedTicket('npsQ3', 'svc-nps3', 'ag2');
      await request(app).post(`/tickets/${t.id}/csat`).send({ rating: 5, serviceId: 'svc-nps3' });
    }
    const res = await request(app).get('/csat/nps').query({ serviceId: 'svc-nps3' });
    expect(res.body.nps).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────
// Cenário 5: Comentário com conteúdo inadequado
// ─────────────────────────────────────────────────────────
describe('Cenário 5 — Conteúdo inadequado no comentário', () => {
  test('Comment with offensive word is accepted but flagged for review', async () => {
    const ticket = await createFinalizedTicket();
    const res = await request(app)
      .post(`/tickets/${ticket.id}/csat`)
      .send({ rating: 1, comment: 'Que idiota esse atendente', attendant: 'atd99', serviceId: 'svc1' });

    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(1);
    expect(res.body.flagged).toBe(true);
  });

  test('Clean comment is NOT flagged', async () => {
    const ticket = await createFinalizedTicket();
    const res = await request(app)
      .post(`/tickets/${ticket.id}/csat`)
      .send({ rating: 5, comment: 'Atendimento ótimo, muito prestativo.', attendant: 'atd1', serviceId: 'svc1' });

    expect(res.status).toBe(201);
    expect(res.body.flagged).toBe(false);
  });

  test('Flagged comments appear in stats with flagged=true marker', async () => {
    const ticket = await createFinalizedTicket('flgQ', 'svc-f', 'atdF');
    await request(app)
      .post(`/tickets/${ticket.id}/csat`)
      .send({ rating: 2, comment: 'Que lixo de serviço', attendant: 'atdF', serviceId: 'svc-f' });

    const res = await request(app).get('/csat/stats').query({ attendant: 'atdF' });
    expect(res.status).toBe(200);
    const flaggedComment = res.body.comments.find(c => c.flagged === true);
    expect(flaggedComment).toBeDefined();
    expect(flaggedComment.flagged).toBe(true);
  });

  test('Numeric rating is still stored correctly even when comment is flagged', async () => {
    const ticket = await createFinalizedTicket();
    const res = await request(app)
      .post(`/tickets/${ticket.id}/csat`)
      .send({ rating: 2, comment: 'Merda de atendimento', attendant: 'atd1', serviceId: 'svc1' });

    expect(res.status).toBe(201);
    expect(res.body.rating).toBe(2);
    expect(res.body.flagged).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// Cenário 6: Anonimato do cidadão (LGPD)
// ─────────────────────────────────────────────────────────
describe('Cenário 6 — Anonimato/LGPD: nenhum dado pessoal exposto', () => {
  test('CSAT stats never expose citizen name, CPF, phone or meta fields', async () => {
    // Ticket has citizen PII in meta
    const r = await request(app).post('/tickets').send({
      queueId: 'lgpdQ',
      meta: { nome: 'João Silva', cpf: '123.456.789-00', telefone: '11999999999', serviceId: 'svc-lgpd' }
    });
    const id = r.body.id;
    await request(app).post(`/tickets/${id}/call`).send({ guiche: 'G1' });
    await request(app).post(`/tickets/${id}/attend`).send({ attendant: 'atdLGPD' });
    await request(app).post(`/tickets/${id}/finalize`).send({ result: {} });
    await request(app).post(`/tickets/${id}/csat`).send({ rating: 3, comment: 'Ok', attendant: 'atdLGPD', serviceId: 'svc-lgpd' });

    const res = await request(app).get('/csat/stats').query({ attendant: 'atdLGPD' });
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/João Silva/);
    expect(body).not.toMatch(/123\.456\.789-00/);
    expect(body).not.toMatch(/11999999999/);
  });

  test('NPS response does not expose citizen PII', async () => {
    db.resetDatabase();
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/tickets').send({
        queueId: 'lgpdNpsQ',
        meta: { nome: 'Maria Souza', cpf: '987.654.321-00', serviceId: 'svc-lgpd2' }
      });
      const id = r.body.id;
      await request(app).post(`/tickets/${id}/call`).send({ guiche: 'G2' });
      await request(app).post(`/tickets/${id}/attend`).send({ attendant: 'ag3' });
      await request(app).post(`/tickets/${id}/finalize`).send({ result: {} });
      await request(app).post(`/tickets/${id}/csat`).send({ rating: 5, serviceId: 'svc-lgpd2' });
    }

    const res = await request(app).get('/csat/nps').query({ serviceId: 'svc-lgpd2' });
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/Maria Souza/);
    expect(body).not.toMatch(/987\.654\.321-00/);
  });

  test('Deduplication: only one CSAT per ticket is accepted', async () => {
    const ticket = await createFinalizedTicket();

    const first = await request(app).post(`/tickets/${ticket.id}/csat`).send({ rating: 5 });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/tickets/${ticket.id}/csat`).send({ rating: 1 });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already submitted/i);
  });
});
