export type ChannelName = "telegram" | "whatsapp";

export type BuildType = "debug" | "release" | "unknown";

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
  readonly source: "aapt" | "aapt2" | "bundletool" | "filename-fallback";
}

export interface WhatsAppRecipient {
  readonly type: "contact" | "group";
  readonly id: string;
}

export interface TelegramConfig {
  readonly enabled: boolean;
  readonly botToken?: string;
  readonly chatIds?: readonly string[];
}

export interface WhatsAppConfig {
  readonly enabled: boolean;
  readonly sessionPath?: string;
  readonly recipients?: readonly WhatsAppRecipient[];
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
}

export interface ProfileConfig {
  readonly defaultChannel: ChannelName;
  readonly telegram: TelegramConfig;
  readonly whatsapp: WhatsAppConfig;
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
  readonly customMessage?: string;
}

export interface NotificationOptions {
  readonly message: string;
  readonly profile?: string;
  readonly channels?: readonly ChannelName[];
}
