const db = require('../app/db');

const viewerSchema = new db.Schema({
  viewers: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

viewerSchema.index({ createdAt: -1 });

const viewer = db.model('viewer', viewerSchema);

module.exports = viewer;
