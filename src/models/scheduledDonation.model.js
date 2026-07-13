const db = require('../app/db');

const scheduledDonationSchema = new db.Schema({
  donorName: { type: String, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  message: { type: String, default: '' },
  currency: { type: String, default: 'RUB' },
  scheduledFor: { type: Date, required: true, index: true },
  status: { type: String, enum: ['pending', 'processing', 'sent', 'failed', 'cancelled'], default: 'pending', index: true },
  sentAt: { type: Date, default: null },
  error: { type: String, default: null },
  createdBy: { type: db.Schema.Types.ObjectId, ref: 'adminUser', default: null },
}, {
  timestamps: true,
});

scheduledDonationSchema.index({ status: 1, scheduledFor: 1 });

module.exports = db.model('scheduledDonation', scheduledDonationSchema);
