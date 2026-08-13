'use strict';

const db = require('../src/app/db');
const { isDbReady, SQLITE_PATH } = require('../src/app/db');
const {
  previewViewerStatsBackfill,
  applyViewerStatsBackfill,
} = require('../src/services/viewerStatsBackfill.service');

function main() {
  if (!isDbReady()) {
    throw new Error(`SQLite is not available: ${SQLITE_PATH}`);
  }

  const shouldApply = process.argv.includes('--apply');
  const result = shouldApply
    ? applyViewerStatsBackfill()
    : previewViewerStatsBackfill();

  console.log(JSON.stringify({
    mode: shouldApply ? 'apply' : 'preview',
    sqlitePath: SQLITE_PATH,
    ...result,
  }, null, 2));

  if (!shouldApply) {
    console.log('No data was changed. Re-run with --apply after reviewing the preview.');
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
} finally {
  if (db.open) {
    db.close();
  }
}
