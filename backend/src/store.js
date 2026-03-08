// Adapter selector: choose DB implementation by `DB_CLIENT` env var
const client = (process.env.DB_CLIENT === 'pg') ? require('./db-pg') : require('./db');

module.exports = {
  createTicket: (...args) => client.createTicket(...args),
  getTicket: (...args) => client.getTicket(...args),
  callTicket: (...args) => client.callTicket(...args),
  attendTicket: (...args) => client.attendTicket(...args),
  finalizeTicket: (...args) => client.finalizeTicket(...args),
  transferTicket: (...args) => client.transferTicket(...args),
  noshowTicket: (...args) => client.noshowTicket(...args),
  listTickets: (...args) => client.listTickets(...args),
  getQueueStats: (...args) => client.getQueueStats(...args),
  submitCsat: (...args) => client.submitCsat(...args),
  getCsatStats: (...args) => client.getCsatStats(...args),
  getCsatNps: (...args) => client.getCsatNps(...args),
  // expose reset for tests if needed
  _resetDatabase: (...args) => client.resetDatabase(...args)
};
