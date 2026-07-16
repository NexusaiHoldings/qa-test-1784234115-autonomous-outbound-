import { buildDb } from "@/lib/db";

export interface FunnelStages {
  prospectsSourced: number;
  emailsSent: number;
  replies: number;
  interested: number;
  meetingsBooked: number;
}

export interface ActivityItem {
  id: string;
  type: "meeting_booked" | "reply_interested" | "reply_received";
  description: string;
  timestamp: string;
}

export interface PipelineMetrics {
  meetingsBookedThisMonth: number;
  meetingsBookedTotal: number;
  timeToFirstMeetingDays: number | null;
  funnelStages: FunnelStages;
  recentActivity: ActivityItem[];
  hasAnyProspects: boolean;
  hasAnySends: boolean;
}

export async function getPipelineMetrics(orgId: string): Promise<PipelineMetrics> {
  const db = buildDb();

  const [
    prospectCountRows,
    emailsSentRows,
    repliesRows,
    interestedRows,
    meetingsTotalRows,
    meetingsThisMonthRows,
    firstSendRows,
    firstMeetingRows,
    recentActivityRows,
  ] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sdr_prospects WHERE org_id = $1`,
      orgId,
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sdr_sequence_touches
       WHERE org_id = $1 AND status = 'sent'`,
      orgId,
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sdr_reply_labels WHERE org_id = $1`,
      orgId,
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sdr_reply_labels
       WHERE org_id = $1 AND effective_label = 'interested'`,
      orgId,
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sdr_meetings WHERE org_id = $1`,
      orgId,
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM sdr_meetings
       WHERE org_id = $1 AND created_at >= date_trunc('month', now())`,
      orgId,
    ),
    db.query<{ sent_at: string }>(
      `SELECT sent_at::text AS sent_at FROM sdr_sequence_touches
       WHERE org_id = $1 AND status = 'sent' AND sent_at IS NOT NULL
       ORDER BY sent_at ASC LIMIT 1`,
      orgId,
    ),
    db.query<{ created_at: string }>(
      `SELECT created_at::text AS created_at FROM sdr_meetings
       WHERE org_id = $1 ORDER BY created_at ASC LIMIT 1`,
      orgId,
    ),
    db.query<{ id: string; activity_type: string; description: string; ts: string }>(
      `SELECT id, activity_type, description, ts::text AS ts
       FROM (
         SELECT
           m.id::text                                                     AS id,
           'meeting_booked'::text                                         AS activity_type,
           ('Meeting booked with ' || p.full_name || ' at ' || p.company) AS description,
           m.created_at                                                   AS ts
         FROM sdr_meetings m
         JOIN sdr_prospects p ON p.id = m.prospect_id
         WHERE m.org_id = $1
         UNION ALL
         SELECT
           rl.id::text                                                     AS id,
           CASE rl.effective_label
             WHEN 'interested' THEN 'reply_interested'
             ELSE 'reply_received'
           END                                                             AS activity_type,
           CASE rl.effective_label
             WHEN 'interested' THEN 'Interested reply from ' || p.full_name || ' at ' || p.company
             ELSE 'Reply from ' || p.full_name || ' at ' || p.company
           END                                                             AS description,
           rl.created_at                                                   AS ts
         FROM sdr_reply_labels rl
         JOIN sdr_prospects p ON p.id = rl.prospect_id
         WHERE rl.org_id = $1
       ) combined
       ORDER BY ts DESC
       LIMIT 10`,
      orgId,
    ),
  ]);

  const prospectsSourced = parseInt(prospectCountRows[0]?.count ?? "0", 10);
  const emailsSent = parseInt(emailsSentRows[0]?.count ?? "0", 10);
  const replies = parseInt(repliesRows[0]?.count ?? "0", 10);
  const interested = parseInt(interestedRows[0]?.count ?? "0", 10);
  const meetingsBooked = parseInt(meetingsTotalRows[0]?.count ?? "0", 10);
  const meetingsBookedThisMonth = parseInt(meetingsThisMonthRows[0]?.count ?? "0", 10);

  let timeToFirstMeetingDays: number | null = null;
  const firstSend = firstSendRows[0]?.sent_at;
  const firstMeeting = firstMeetingRows[0]?.created_at;
  if (firstSend && firstMeeting) {
    const diffMs = new Date(firstMeeting).getTime() - new Date(firstSend).getTime();
    if (diffMs >= 0) {
      timeToFirstMeetingDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    }
  }

  const recentActivity: ActivityItem[] = recentActivityRows.map((row) => ({
    id: row.id,
    type: row.activity_type as ActivityItem["type"],
    description: row.description,
    timestamp: row.ts,
  }));

  return {
    meetingsBookedThisMonth,
    meetingsBookedTotal: meetingsBooked,
    timeToFirstMeetingDays,
    funnelStages: {
      prospectsSourced,
      emailsSent,
      replies,
      interested,
      meetingsBooked,
    },
    recentActivity,
    hasAnyProspects: prospectsSourced > 0,
    hasAnySends: emailsSent > 0,
  };
}
