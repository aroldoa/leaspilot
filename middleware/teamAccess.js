/**
 * Returns an array of user IDs whose properties the caller can access:
 * their own ID plus any owners who have added them as a team member.
 * Falls back to [userId] silently if team_members table doesn't exist yet.
 */
export async function getOwnerIds(pool, userId) {
  try {
    const r = await pool.query(
      `SELECT DISTINCT owner_user_id FROM team_members WHERE member_user_id = $1`,
      [userId]
    );
    return [userId, ...r.rows.map(row => row.owner_user_id)];
  } catch {
    return [userId];
  }
}
