const db = require('../app/db');

const memeLogSchema = new db.Schema({
  eventId: { type: String, index: true },
  user: String,
  userAlias: String,
  stickerName: String,
  kind: String,
  sentAt: Date,
  streamSessionId: { type: db.Schema.Types.ObjectId, ref: 'streamSession', default: null },
  raw: db.Schema.Types.Mixed,
}, {
  timestamps: true,
});

memeLogSchema.index({ user: 1, sentAt: -1 });
memeLogSchema.index({ sentAt: -1 });
memeLogSchema.index({ streamSessionId: 1 });

const MemeLog = db.model('memeLog', memeLogSchema);

module.exports = MemeLog;
