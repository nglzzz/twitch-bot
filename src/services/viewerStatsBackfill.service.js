'use strict';

const { db, stmt } = require('../repositories/base');

const CANDIDATE_LINKS_SQL = `
  SELECT v.id AS viewer_id, MIN(s.id) AS stream_session_id
  FROM viewer v
  JOIN stream_session s
    ON s.status = 'ended'
   AND s.viewer_snapshot_count = 0
   AND s.started_at IS NOT NULL
   AND s.ended_at IS NOT NULL
   AND v.created_at BETWEEN s.started_at AND s.ended_at
  WHERE v.stream_session_id IS NULL
  GROUP BY v.id
  HAVING COUNT(s.id) = 1
  ORDER BY v.created_at ASC
`;

function findCandidateLinks() {
  return stmt(CANDIDATE_LINKS_SQL).all();
}

function previewViewerStatsBackfill() {
  const links = findCandidateLinks();

  return {
    candidateSnapshots: links.length,
    candidateSessions: new Set(links.map((link) => link.stream_session_id)).size,
  };
}

function applyViewerStatsBackfill() {
  const runBackfill = db.transaction(() => {
    const links = findCandidateLinks();
    const linkSnapshot = stmt(
      `UPDATE viewer
       SET stream_session_id = ?, updated_at = ?
       WHERE id = ? AND stream_session_id IS NULL`
    );
    const aggregateSnapshots = stmt(
      `SELECT
         COUNT(*) AS snapshot_count,
         COALESCE(SUM(CASE WHEN json_valid(viewers) THEN json_array_length(viewers) ELSE 0 END), 0) AS snapshot_sum,
         COALESCE(MAX(CASE WHEN json_valid(viewers) THEN json_array_length(viewers) ELSE 0 END), 0) AS max_viewers
       FROM viewer
       WHERE stream_session_id = ?`
    );
    const updateSession = stmt(
      `UPDATE stream_session SET
         viewer_snapshot_count = ?,
         viewer_snapshot_sum = ?,
         max_viewers = ?,
         avg_viewers = ?,
         updated_at = ?
       WHERE id = ? AND viewer_snapshot_count = 0`
    );

    const linkedSessionIds = new Set();
    let linkedSnapshots = 0;
    const now = Date.now();

    links.forEach((link) => {
      const result = linkSnapshot.run(link.stream_session_id, now, link.viewer_id);
      if (result.changes > 0) {
        linkedSnapshots += result.changes;
        linkedSessionIds.add(link.stream_session_id);
      }
    });

    let updatedSessions = 0;
    linkedSessionIds.forEach((sessionId) => {
      const aggregate = aggregateSnapshots.get(sessionId);
      if (!aggregate || aggregate.snapshot_count === 0) {
        return;
      }

      const averageViewers = Math.round(aggregate.snapshot_sum / aggregate.snapshot_count);
      const result = updateSession.run(
        aggregate.snapshot_count,
        aggregate.snapshot_sum,
        aggregate.max_viewers,
        averageViewers,
        now,
        sessionId
      );
      updatedSessions += result.changes;
    });

    return {
      linkedSnapshots,
      updatedSessions,
    };
  });

  return runBackfill();
}

module.exports = {
  previewViewerStatsBackfill,
  applyViewerStatsBackfill,
};
