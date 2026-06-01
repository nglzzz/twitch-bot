const db = require('../app/db');

const chatLogSchema = new db.Schema({
  user: String,
  displayName: String,
  message: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

chatLogSchema.index({ createdAt: -1 });
chatLogSchema.index({ user: 1, createdAt: -1 });

const chatLog = db.model('chatLog', chatLogSchema);

module.exports = chatLog;
