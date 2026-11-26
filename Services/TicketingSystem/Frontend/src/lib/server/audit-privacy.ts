type CommentAudit = { action: string; old_value: string | null; new_value: string | null };

export function redactCommentAudit<T extends CommentAudit>(row: T, canSeeInternal: boolean) {
  if (canSeeInternal) return row;
  if (['comment_added', 'comment_updated'].includes(row.action) && row.old_value === 'internal') return { ...row, new_value: null };
  // Legacy deletions did not record visibility, so their text cannot safely be shown to requesters.
  if (row.action === 'comment_deleted') return { ...row, old_value: null, new_value: null };
  return row;
}
