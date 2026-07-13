const db = require('../app/db');

const scheduledMemeSchema = new db.Schema({
  stickerId: { type: String, default: '', trim: true },
  selection: { type: String, enum: ['random', 'sticker'], default: 'random' },
  sender: { type: String, enum: ['owner', 'test'], default: 'test' },
  message: { type: String, default: '' },
  isSoundOnly: { type: Boolean, default: false },
  scheduledFor: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'processing', 'sent', 'failed', 'cancelled'], default: 'pending', index: true },
  sentAt: { type: Date, default: null },
  error: { type: String, default: null },
  createdBy: { type: db.Schema.Types.ObjectId, ref: 'adminUser', default: null },
}, {
  timestamps: true,
});

scheduledMemeSchema.index({ status: 1, scheduledFor: 1 });

module.exports = db.model('scheduledMeme', scheduledMemeSchema);
