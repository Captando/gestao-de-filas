const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const connectionString = process.env.DATABASE_URL || process.env.PG_CONNECTION || 'postgres://postgres:postgres@localhost:5432/gestao_filas';
const pool = new Pool({ connectionString });

async function initSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS queues (
    queueId TEXT PRIMARY KEY,
    lastNumber INTEGER DEFAULT 0
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS csat_responses (
    id TEXT PRIMARY KEY,
    ticketId TEXT NOT NULL UNIQUE,
    attendant TEXT,
    serviceId TEXT,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    skipped BOOLEAN NOT NULL DEFAULT FALSE,
    createdAt TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_csat_attendant ON csat_responses(attendant)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_csat_service ON csat_responses(serviceId)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_csat_created ON csat_responses(createdAt)');

  await pool.query(`CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    queueId TEXT,
    number INTEGER,
    meta JSONB,
    status TEXT,
    createdAt TIMESTAMPTZ,
    calledAt TIMESTAMPTZ,
    attendedAt TIMESTAMPTZ,
    finalizedAt TIMESTAMPTZ,
    noshowAt TIMESTAMPTZ,
    guiche TEXT,
    attendant TEXT,
    result JSONB,
    noshowReason TEXT,
    history JSONB
  )`);
}

function _parseJsonField(v) {
  if (v == null) return null;
  return v;
}

function _rowToTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    queueId: row.queueid || row.queueId,
    number: row.number,
    meta: row.meta || {},
    status: row.status,
    createdAt: row.createdat ? row.createdat.toISOString() : null,
    calledAt: row.calledat ? row.calledat.toISOString() : null,
    attendedAt: row.attendedat ? row.attendedat.toISOString() : null,
    finalizedAt: row.finalizedat ? row.finalizedat.toISOString() : null,
    noshowAt: row.noshowat ? row.noshowat.toISOString() : null,
    guiche: row.guiche,
    attendant: row.attendant,
    result: row.result || null,
    noshowReason: row.noshowreason || null,
    history: row.history || []
  };
}

async function resetDatabase() {
  await pool.query('DROP TABLE IF EXISTS tickets');
  await pool.query('DROP TABLE IF EXISTS queues');
  await initSchema();
}

async function ensureQueue(queueId) {
  const r = await pool.query('SELECT queueId, lastNumber FROM queues WHERE queueId = $1', [queueId]);
  if (r.rows.length) return r.rows[0];
  await pool.query('INSERT INTO queues(queueId, lastNumber) VALUES($1, $2)', [queueId, 0]);
  return { queueid: queueId, lastnumber: 0 };
}

async function createTicket(queueId, meta = {}) {
  await ensureQueue(queueId);
  const lastRes = await pool.query('SELECT lastNumber FROM queues WHERE queueId = $1', [queueId]);
  const last = lastRes.rows[0].lastnumber || lastRes.rows[0].lastNumber || 0;
  const number = last + 1;
  await pool.query('UPDATE queues SET lastNumber = $1 WHERE queueId = $2', [number, queueId]);
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const history = [{ when: createdAt, action: 'created' }];
  await pool.query(`INSERT INTO tickets(id, queueId, number, meta, status, createdAt, history)
    VALUES($1,$2,$3,$4,$5,$6,$7)`, [id, queueId, number, JSON.stringify(meta), 'waiting', createdAt, JSON.stringify(history)]);
  return getTicket(id);
}

async function getTicket(id) {
  const r = await pool.query('SELECT * FROM tickets WHERE id = $1', [id]);
  return _rowToTicket(r.rows[0]);
}

async function updateTicket(id, patch) {
  const t = await getTicket(id);
  if (!t) return null;
  const merged = Object.assign({}, t, patch);
  const history = Array.isArray(merged.history) ? merged.history : (t.history || []);
  await pool.query(`UPDATE tickets SET queueId=$1, number=$2, meta=$3, status=$4, createdAt=$5, calledAt=$6, attendedAt=$7, finalizedAt=$8, noshowAt=$9, guiche=$10, attendant=$11, result=$12, noshowReason=$13, history=$14 WHERE id=$15`, [
    merged.queueId,
    merged.number,
    JSON.stringify(merged.meta || {}),
    merged.status,
    merged.createdAt,
    merged.calledAt || null,
    merged.attendedAt || null,
    merged.finalizedAt || null,
    merged.noshowAt || null,
    merged.guiche || null,
    merged.attendant || null,
    JSON.stringify(merged.result || null),
    merged.noshowReason || null,
    JSON.stringify(history),
    id
  ]);
  return getTicket(id);
}

async function callTicket(id, guiche) {
  const t = await getTicket(id);
  if (!t) return null;
  const calledAt = new Date().toISOString();
  t.status = 'called';
  t.calledAt = calledAt;
  t.guiche = guiche || null;
  t.history = t.history || [];
  t.history.push({ when: calledAt, action: 'called', guiche });
  return updateTicket(id, t);
}

async function attendTicket(id, attendant) {
  const t = await getTicket(id);
  if (!t) return null;
  const attendedAt = new Date().toISOString();
  t.status = 'attending';
  t.attendedAt = attendedAt;
  t.attendant = attendant || null;
  t.history = t.history || [];
  t.history.push({ when: attendedAt, action: 'attending', attendant });
  return updateTicket(id, t);
}

async function finalizeTicket(id, result = {}) {
  const t = await getTicket(id);
  if (!t) return null;
  const finalizedAt = new Date().toISOString();
  t.status = 'finalized';
  t.finalizedAt = finalizedAt;
  t.result = result;
  t.history = t.history || [];
  t.history.push({ when: finalizedAt, action: 'finalized', result });
  return updateTicket(id, t);
}

async function transferTicket(id, destQueueId, reason) {
  const t = await getTicket(id);
  if (!t) return null;
  const from = t.queueId;
  if (from === destQueueId) return t;
  await ensureQueue(destQueueId);
  t.queueId = destQueueId;
  t.status = 'waiting';
  const when = new Date().toISOString();
  t.history = t.history || [];
  t.history.push({ when, action: 'transferred', from, to: destQueueId, reason });
  return updateTicket(id, t);
}

async function noshowTicket(id, reason) {
  const t = await getTicket(id);
  if (!t) return null;
  const when = new Date().toISOString();
  t.status = 'noshow';
  t.noshowAt = when;
  t.noshowReason = reason || null;
  t.history = t.history || [];
  t.history.push({ when, action: 'noshow', reason });
  return updateTicket(id, t);
}

async function listTickets(filter = {}) {
  const clauses = [];
  const params = [];
  if (filter.queueId) { params.push(filter.queueId); clauses.push(`queueId = $${params.length}`); }
  if (filter.status) { params.push(filter.status); clauses.push(`status = $${params.length}`); }
  let sql = 'SELECT * FROM tickets';
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  if (filter.status === 'waiting') {
    sql += " ORDER BY CASE WHEN (meta->>'priority')::boolean = true THEN 0 ELSE 1 END NULLS LAST, number ASC";
  } else {
    sql += ' ORDER BY number ASC';
  }
  const r = await pool.query(sql, params);
  return r.rows.map(_rowToTicket);
}

async function getQueueStats(queueId) {
  const totalRes = await pool.query('SELECT COUNT(*) as cnt FROM tickets WHERE queueId = $1', [queueId]);
  const waitingRes = await pool.query('SELECT COUNT(*) as cnt FROM tickets WHERE queueId = $1 AND status = $2', [queueId, 'waiting']);
  const calledRes = await pool.query('SELECT COUNT(*) as cnt FROM tickets WHERE queueId = $1 AND (status = $2 OR status = $3)', [queueId, 'called', 'attending']);
  const finalizedRes = await pool.query('SELECT COUNT(*) as cnt FROM tickets WHERE queueId = $1 AND status = $2', [queueId, 'finalized']);

  const rows = (await pool.query('SELECT createdAt, calledAt, finalizedAt FROM tickets WHERE queueId = $1 AND status = $2', [queueId, 'finalized'])).rows;
  const samples = rows.map(r => {
    const a = new Date(r.createdat || r.createdAt);
    const b = r.calledat ? new Date(r.calledat) : new Date(r.finalizedat || r.finalizedAt || r.createdAt);
    return (b - a) / 1000;
  }).filter(x => !Number.isNaN(x));
  const tme = samples.length ? Math.round(samples.reduce((s,x)=>s+x,0)/samples.length) : null;

  return {
    queueId,
    count: parseInt(totalRes.rows[0].cnt, 10),
    waiting: parseInt(waitingRes.rows[0].cnt, 10),
    called: parseInt(calledRes.rows[0].cnt, 10),
    finalized: parseInt(finalizedRes.rows[0].cnt, 10),
    tme_seconds: tme
  };
}

const OFFENSIVE_WORDS = [
  'merda', 'idiota', 'imbecil', 'lixo', 'droga', 'maldito', 'otario', 'otário',
  'burro', 'incompetente', 'vagabundo', 'inútil', 'inutil'
];

function isFlagged(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return OFFENSIVE_WORDS.some(w => lower.includes(w));
}

async function submitCsat(ticketId, { rating, comment, skipped, attendant, serviceId } = {}) {
  const existing = await pool.query('SELECT id FROM csat_responses WHERE ticketId = $1', [ticketId]);
  if (existing.rows.length) return null;

  const id = uuidv4();
  const createdAt = new Date().toISOString();
  const isSkipped = !!skipped;
  const safeRating = isSkipped ? null : (rating || null);
  const safeComment = isSkipped ? null : (comment || null);
  const flaggedVal = isFlagged(safeComment);

  await pool.query(
    `INSERT INTO csat_responses(id, ticketId, attendant, serviceId, rating, comment, flagged, skipped, createdAt)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, ticketId, attendant || null, serviceId || null, safeRating, safeComment, flaggedVal, isSkipped, createdAt]
  );
  return { id, ticketId, attendant: attendant || null, serviceId: serviceId || null, rating: safeRating, comment: safeComment, flagged: flaggedVal, skipped: isSkipped, createdAt };
}

async function getCsatStats({ attendant, serviceId, from, to } = {}) {
  let sql = 'SELECT id, ticketId, attendant, serviceId, rating, comment, flagged, skipped, createdAt FROM csat_responses';
  const clauses = [];
  const params = [];

  if (attendant) { params.push(attendant); clauses.push(`attendant = $${params.length}`); }
  if (serviceId) { params.push(serviceId); clauses.push(`serviceId = $${params.length}`); }
  if (from) { params.push(from); clauses.push(`createdAt >= $${params.length}`); }
  if (to) { params.push(to); clauses.push(`createdAt <= $${params.length}`); }

  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');

  const { rows } = await pool.query(sql, params);
  const total = rows.length;
  const answered = rows.filter(r => !r.skipped);
  const ratings = answered.map(r => r.rating).filter(r => r != null);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  ratings.forEach(r => { if (distribution[r] !== undefined) distribution[r]++; });

  const ratingsSum = ratings.reduce((s, x) => s + x, 0);
  const avgCsat = ratings.length ? Math.round((ratingsSum / ratings.length) * 100) / 100 : null;
  const responseRate = total > 0 ? Math.round((answered.length / total) * 10000) / 100 : 0;

  const comments = answered
    .filter(r => r.comment)
    .map(r => ({ id: r.id, ticketId: r.ticketid || r.ticketId, rating: r.rating, comment: r.comment, flagged: !!r.flagged }));

  return { total, answered: answered.length, avgCsat, distribution, responseRate, comments };
}

async function getCsatNps({ serviceId, from, to } = {}) {
  let sql = 'SELECT rating FROM csat_responses WHERE skipped = false AND rating IS NOT NULL';
  const params = [];

  if (serviceId) { params.push(serviceId); sql += ` AND serviceId = $${params.length}`; }
  if (from) { params.push(from); sql += ` AND createdAt >= $${params.length}`; }
  if (to) { params.push(to); sql += ` AND createdAt <= $${params.length}`; }

  const { rows } = await pool.query(sql, params);

  if (rows.length < 10) {
    return { nps: null, message: 'Dados insuficientes para cálculo de NPS', total: rows.length, required: 10 };
  }

  const total = rows.length;
  const promoters = rows.filter(r => r.rating >= 4).length;
  const detractors = rows.filter(r => r.rating <= 2).length;
  const nps = Math.round(((promoters / total) - (detractors / total)) * 100);

  return { nps, total, promoters, neutrals: total - promoters - detractors, detractors, message: null };
}

module.exports = {
  initSchema,
  createTicket,
  getTicket,
  callTicket,
  attendTicket,
  finalizeTicket,
  transferTicket,
  noshowTicket,
  listTickets,
  getQueueStats,
  submitCsat,
  getCsatStats,
  getCsatNps,
  resetDatabase,
  _pool: pool
};
