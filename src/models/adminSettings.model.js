const db = require('../app/db');

const adminSettingsSchema = new db.Schema({
  singletonKey: { type: String, default: 'primary', unique: true },
  donationAlertsApiKey: { type: String, default: '' },
  streamElementsToken: { type: String, default: '' },
  streamElementsChannelId: { type: String, default: '' },
  memeAlertsChannelId: { type: String, default: '' },
  memeAlertsTestToken: { type: String, default: '' },
  memeAlertsTestCsrf: { type: String, default: '' },
  memeAlertsTestCsrfToken: { type: String, default: '' },
  memeAlertsTestName: { type: String, default: '' },
}, {
  timestamps: true,
});

module.exports = db.model('adminSettings', adminSettingsSchema);
