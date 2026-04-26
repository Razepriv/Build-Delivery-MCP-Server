import type { RecipientTag, TaggedRecipient } from "../types.js";

/**
 * Filter a recipient list by tags. If `requested` is empty/undefined, all
 * recipients pass through. Otherwise we keep recipients that carry *any*
 * of the requested tags (OR semantics — never AND).
 *
 * Recipients without tags are kept only when the filter is empty; once a
 * filter is requested, an unlabelled recipient is excluded by design (so
 * that adding tags to *some* recipients doesn't accidentally broadcast to
 * everyone).
 */
export function filterByTags<T extends Pick<TaggedRecipient, "tags">>(
  recipients: readonly T[],
  requested?: readonly RecipientTag[],
): T[] {
  if (!requested || requested.length === 0) return recipients.slice();
  const wanted = new Set(requested.map((t) => t.toLowerCase()));
  return recipients.filter((r) => {
    const tags = r.tags ?? [];
    return tags.some((t) => wanted.has(t.toLowerCase()));
  });
}

/**
 * Telegram chat IDs are stored as a parallel array with tags in `chatTags`.
 * This pairs them up before applying the same filter.
 */
export function tagTelegramChats(
  chatIds: readonly string[],
  chatTags: Readonly<Record<string, readonly RecipientTag[]>> | undefined,
): { id: string; tags?: readonly RecipientTag[] }[] {
  return chatIds.map((id) => ({
    id,
    tags: chatTags?.[id],
  }));
}
