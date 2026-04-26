import type { ChannelName } from "../types.js";
import type { IntelPayload } from "./captions.js";
import type { DeliveryIntel } from "../intel/orchestrator.js";

/**
 * Compose a per-recipient IntelPayload from a build-level DeliveryIntel.
 * The install URL preference is: per-(channel,recipient) → build-level
 * default → none. Used by every channel service.
 */
export function intelForRecipient(
  intel: DeliveryIntel | undefined,
  channel: ChannelName,
  recipientId: string,
): IntelPayload | undefined {
  if (!intel) return undefined;
  const installUrl = intel.installUrlFor?.(channel, recipientId) ?? intel.defaultInstallUrl;
  if (!intel.changelog && !intel.crashStats && !installUrl) return undefined;
  return {
    changelog: intel.changelog,
    crashStats: intel.crashStats,
    installUrl,
  };
}
