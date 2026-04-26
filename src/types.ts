export type ChannelName =
  | "telegram"
  | "whatsapp"
  | "slack"
  | "discord"
  | "email"
  | "teams";

export type BuildType = "debug" | "release" | "unknown";

export type ParserSource =
  | "aapt"
  | "aapt2"
  | "bundletool"
  | "ipa-plist"
  | "filename-fallback";

export interface BuildMetadata {
  readonly filePath: string;
  readonly fileSize: number;
  readonly appName: string;
  readonly packageName: string;
  readonly versionName: string;
  readonly versionCode: string;
  readonly buildType: BuildType;
  readonly minSdkVersion?: string;
  readonly targetSdkVersion?: string;
  readonly source: ParserSource;
}

/** A label like "qa-team" or "ios-leads" attached to a recipient. */
export type RecipientTag = string;

/**
 * A recipient with tags. Used by send_build's `tags` filter to scope
 * delivery — e.g. only push to recipients tagged "qa-team".
 */
export interface TaggedRecipient {
  readonly id: string;
  readonly tags?: readonly RecipientTag[];
}

export interface WhatsAppRecipient extends TaggedRecipient {
  readonly type: "contact" | "group";
}

export interface TelegramConfig {
  readonly enabled: boolean;
  readonly botToken?: string;
  readonly chatIds?: readonly string[];
  /** Optional per-chat-id tags. Keyed by chatId. */
  readonly chatTags?: Readonly<Record<string, readonly RecipientTag[]>>;
}

export interface WhatsAppConfig {
  readonly enabled: boolean;
  readonly sessionPath?: string;
  readonly recipients?: readonly WhatsAppRecipient[];
}

export interface SlackConfig {
  readonly enabled: boolean;
  readonly botToken?: string;
  readonly channels?: readonly TaggedRecipient[];
}

export interface DiscordConfig {
  readonly enabled: boolean;
  readonly webhooks?: readonly TaggedRecipient[];
}

export interface EmailRecipient extends TaggedRecipient {
  readonly displayName?: string;
}

export interface EmailConfig {
  readonly enabled: boolean;
  readonly smtp?: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user?: string;
    readonly pass?: string;
  };
  readonly from?: string;
  readonly recipients?: readonly EmailRecipient[];
}

export interface TeamsConfig {
  readonly enabled: boolean;
  readonly webhooks?: readonly TaggedRecipient[];
}

export interface WatcherConfig {
  readonly directories: readonly string[];
  readonly extensions: readonly string[];
  readonly ignorePatterns: readonly string[];
  readonly stabilityThresholdMs: number;
}

export interface NamingConfig {
  readonly pattern: string;
}

export interface LimitsConfig {
  readonly maxFileSizeMB: number;
  readonly whatsappMaxMB: number;
  readonly slackMaxMB: number;
  readonly discordMaxMB: number;
  readonly emailMaxMB: number;
}

export interface ProfileConfig {
  readonly defaultChannel: ChannelName;
  readonly telegram: TelegramConfig;
  readonly whatsapp: WhatsAppConfig;
  readonly slack: SlackConfig;
  readonly discord: DiscordConfig;
  readonly email: EmailConfig;
  readonly teams: TeamsConfig;
  readonly watcher: WatcherConfig;
  readonly naming: NamingConfig;
  readonly limits: LimitsConfig;
}

export interface RootConfig {
  readonly defaultProfile: string;
  readonly profiles: Readonly<Record<string, ProfileConfig>>;
}

export interface DeliveryResult {
  readonly channel: ChannelName;
  readonly recipient: string;
  readonly success: boolean;
  readonly messageId?: string;
  readonly error?: string;
  readonly durationMs: number;
}

export interface BuildHistoryEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly profile: string;
  readonly originalPath: string;
  readonly renamedFilename: string;
  readonly metadata: BuildMetadata;
  readonly results: readonly DeliveryResult[];
}

export interface SendBuildOptions {
  readonly filePath: string;
  readonly profile?: string;
  readonly appName?: string;
  readonly version?: string;
  readonly channels?: readonly ChannelName[];
  /** If set, only deliver to recipients carrying any of these tags. */
  readonly tags?: readonly RecipientTag[];
  readonly customMessage?: string;
}

export interface NotificationOptions {
  readonly message: string;
  readonly profile?: string;
  readonly channels?: readonly ChannelName[];
  readonly tags?: readonly RecipientTag[];
}
