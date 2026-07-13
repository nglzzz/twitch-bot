const db = require('../app/db');

const donationSchema = new db.Schema({
  source: { type: String, enum: ['donationalerts', 'manual', 'scheduled'], required: true },
  isTest: { type: Boolean, default: false, index: true },
  externalId: { type: String, default: undefined },
  donorName: { type: String, required: true },
  donorId: { type: String, default: '' },
  message: { type: String, default: '' },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, default: 'RUB' },
  streamSessionId: { type: db.Schema.Types.ObjectId, ref: 'streamSession', default: null },
  streamElementsActivityId: { type: String, default: null },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  error: { type: String, default: null },
  raw: { type: db.Schema.Types.Mixed, default: null },
}, {
  timestamps: true,
  autoIndex: false,
});

donationSchema.index({ source: 1, externalId: 1 }, {
  unique: true,
  partialFilterExpression: { externalId: { $type: 'string' } },
  name: 'source_externalId_unique',
});
donationSchema.index({ streamSessionId: 1, createdAt: -1 });
donationSchema.index({ createdAt: -1 });

module.exports = db.model('donation', donationSchema);
