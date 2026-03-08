const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const store = require('./store');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ service: 'gestao-filas-backend', status: 'ok' }));

// Emitir senha
app.post('/tickets', async (req, res) => {
  const { queueId, meta } = req.body;
  if (!queueId) return res.status(400).json({ error: 'queueId is required' });
  try {
    const ticket = await store.createTicket(queueId, meta || {});
    // broadcast via websocket
    if (global.__wss_broadcast) global.__wss_broadcast({ type: 'ticket.created', ticket });
    res.status(201).json(ticket);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List tickets (optionally filter by queue)
app.get('/tickets', async (req, res) => {
  const { queueId, status } = req.query;
  try {
    const list = await store.listTickets({ queueId, status });
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chamar senha (guichê)
app.post('/tickets/:id/call', async (req, res) => {
  const { id } = req.params;
  const { guiche } = req.body;
  try {
    const t = await store.callTicket(id, guiche);
    if (!t) return res.status(404).json({ error: 'ticket not found' });
    if (global.__wss_broadcast) global.__wss_broadcast({ type: 'ticket.called', ticket: t });
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Transferir ticket
app.post('/tickets/:id/transfer', async (req, res) => {
  const { id } = req.params;
  const { toQueueId, reason } = req.body;
  if (!toQueueId) return res.status(400).json({ error: 'toQueueId is required' });
  try {
    const t = await store.transferTicket(id, toQueueId, reason);
    if (!t) return res.status(404).json({ error: 'ticket not found' });
    if (global.__wss_broadcast) global.__wss_broadcast({ type: 'ticket.transferred', ticket: t });
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// No-show
app.post('/tickets/:id/noshow', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  try {
    const t = await store.noshowTicket(id, reason);
    if (!t) return res.status(404).json({ error: 'ticket not found' });
    if (global.__wss_broadcast) global.__wss_broadcast({ type: 'ticket.noshow', ticket: t });
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Atender
app.post('/tickets/:id/attend', async (req, res) => {
  const { id } = req.params;
  const { attendant } = req.body;
  try {
    const t = await store.attendTicket(id, attendant);
    if (!t) return res.status(404).json({ error: 'ticket not found' });
    if (global.__wss_broadcast) global.__wss_broadcast({ type: 'ticket.attending', ticket: t });
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Finalizar
app.post('/tickets/:id/finalize', async (req, res) => {
  const { id } = req.params;
  const { result } = req.body;
  try {
    const t = await store.finalizeTicket(id, result || {});
    if (!t) return res.status(404).json({ error: 'ticket not found' });
    if (global.__wss_broadcast) global.__wss_broadcast({ type: 'ticket.finalized', ticket: t });
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Queue stats
app.get('/queues/:id/stats', async (req, res) => {
  const { id } = req.params;
  try {
    const stats = await store.getQueueStats(id);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSAT: submit rating (or skip) after ticket finalization
app.post('/tickets/:id/csat', async (req, res) => {
  const { id } = req.params;
  const { rating, comment, skipped, attendant, serviceId } = req.body;

  const ticket = await store.getTicket(id);
  if (!ticket) return res.status(404).json({ error: 'ticket not found' });

  if (!skipped) {
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }
  }

  try {
    const csat = await store.submitCsat(id, { rating, comment, skipped: !!skipped, attendant, serviceId });
    if (!csat) return res.status(409).json({ error: 'CSAT already submitted for this ticket' });
    res.status(201).json(csat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSAT stats: avg, distribution, response rate, comments (anonymized) — Scenario 3
app.get('/csat/stats', async (req, res) => {
  const { attendant, serviceId, from, to } = req.query;
  try {
    const stats = await store.getCsatStats({ attendant, serviceId, from, to });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CSAT NPS by service — Scenario 4
app.get('/csat/nps', async (req, res) => {
  const { serviceId, from, to } = req.query;
  try {
    const nps = await store.getCsatNps({ serviceId, from, to });
    res.json(nps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = http.createServer(app);

// attach WebSocket server
const wss = new WebSocket.Server({ server });

function broadcast(data){
  const s = JSON.stringify(data);
  wss.clients.forEach(c => {
    if(c.readyState === WebSocket.OPEN) c.send(s);
  });
}

global.__wss_broadcast = broadcast;

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;

  async function start() {
    if (process.env.DB_CLIENT === 'pg') {
      try {
        const pg = require('./db-pg');
        if (pg && typeof pg.initSchema === 'function') {
          console.log('Initializing Postgres schema...');
          await pg.initSchema();
          console.log('Postgres schema ready');
        }
      } catch (err) {
        console.error('Failed to initialize Postgres schema:', err);
        process.exit(1);
      }
    }

    server.listen(port, () => console.log(`gestao-filas-backend listening on ${port}`));
  }

  start();
}
