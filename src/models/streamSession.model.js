const db = require('../app/db');

const streamSessionSchema = new db.Schema({
  streamId: { type: String, index: true },
  title: String,
  gameName: String,
  startedAt: Date,
  endedAt: Date,
  status: { type: String, default: 'live', enum: ['live', 'ended'] },
  lastSeenAt: Date,
  maxViewers: { type: Number, default: 0 },
  avgViewers: { type: Number, default: 0 },
  viewerSnapshotCount: { type: Number, default: 0 },
  viewerSnapshotSum: { type: Number, default: 0 },
  uniqueViewers: { type: Number, default: 0 },
  messagesCount: { type: Number, default: 0 },
  uniqueChatters: { type: Number, default: 0 },
  memesCount: { type: Number, default: 0 },
}, {
  timestamps: true,
});

streamSessionSchema.index({ status: 1, startedAt: -1 });
streamSessionSchema.index({ startedAt: -1 });

streamSessionSchema.methods.updateViewers = function (currentCount) {
  this.viewerSnapshotCount += 1;
  this.viewerSnapshotSum += currentCount;
  this.maxViewers = Math.max(this.maxViewers, currentCount);
  this.avgViewers = Math.round(this.viewerSnapshotSum / this.viewerSnapshotCount);
  this.lastSeenAt = new Date();
};

const StreamSession = db.model('streamSession', streamSessionSchema);

module.exports = StreamSession;
