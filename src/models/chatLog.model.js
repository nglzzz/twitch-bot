const db = require('../app/db');

const chatLogSchema = new db.Schema({
  user: String,
  message: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const chatLog = db.model('chatLog', chatLogSchema);

module.exports = chatLog;
