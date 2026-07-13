const db = require('../app/db');

const adminUserSchema = new db.Schema({
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin'], default: 'admin' },
  isActive: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = db.model('adminUser', adminUserSchema);
