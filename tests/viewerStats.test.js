'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-bot-viewer-stats-'));
process.env.SQLITE_PATH = path.join(temporaryDirectory, 'test.sqlite');

const db = require('../src/app/db');
const streamSessionRepo = require('../src/repositories/streamSession.repo');
const viewerRepo = require('../src/repositories/viewer.repo');
const {
  previewViewerStatsBackfill,
  applyViewerStatsBackfill,
} = require('../src/services/viewerStatsBackfill.service');

after(() => {
  if (db.open) {
    db.close();
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('applyViewerUpdate stores peak and rounded average viewer counts', () => {
  const session = streamSessionRepo.create({
    streamId: 'viewer-update-test',
    status: 'live',
  });

  streamSessionRepo.applyViewerUpdate(session._id, 42);
  streamSessionRepo.applyViewerUpdate(session._id, 18);
  streamSessionRepo.applyViewerUpdate(session._id, 21);

  const updated = streamSessionRepo.findById(session._id);
  assert.equal(updated.viewerSnapshotCount, 3);
  assert.equal(updated.viewerSnapshotSum, 81);
  assert.equal(updated.maxViewers, 42);
  assert.equal(updated.avgViewers, 27);
});

test('viewer stats backfill links unassigned snapshots and is idempotent', () => {
  const now = Date.now();
  const session = streamSessionRepo.create({
    streamId: 'viewer-backfill-test',
    startedAt: now - 60_000,
    status: 'live',
  });
  streamSessionRepo.update(session._id, {
    status: 'ended',
    endedAt: now + 60_000,
  });

  viewerRepo.insert({ viewers: ['one', 'two', 'three'] });
  viewerRepo.insert({ viewers: ['one', 'two', 'three', 'four'] });

  assert.deepEqual(previewViewerStatsBackfill(), {
    candidateSnapshots: 2,
    candidateSessions: 1,
  });
  assert.deepEqual(applyViewerStatsBackfill(), {
    linkedSnapshots: 2,
    updatedSessions: 1,
  });

  const updated = streamSessionRepo.findById(session._id);
  assert.equal(updated.viewerSnapshotCount, 2);
  assert.equal(updated.viewerSnapshotSum, 7);
  assert.equal(updated.maxViewers, 4);
  assert.equal(updated.avgViewers, 4);
  assert.equal(viewerRepo.findSnapshots({ streamSessionId: session._id }).length, 2);

  assert.deepEqual(applyViewerStatsBackfill(), {
    linkedSnapshots: 0,
    updatedSessions: 0,
  });
});
