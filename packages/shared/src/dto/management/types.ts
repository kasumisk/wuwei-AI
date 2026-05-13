/**
 * 能力类型枚举
 * 定义系统支持的AI能力类型
 */
export enum CapabilityType {
  TEXT_GENERATION = 'text.generation',
  TEXT_COMPLETION = 'text.completion',
  TEXT_EMBEDDING = 'text.embedding',
  IMAGE_GENERATION = 'image.generation',
  IMAGE_EDIT = 'image.edit',
  SPEECH_TO_TEXT = 'speech.to_text',
  TEXT_TO_SPEECH = 'text.to_speech',
  TRANSLATION = 'translation',
  MODERATION = 'moderation',
}

export const CAPABILITY_TYPES = Object.values(CapabilityType);

export const API_TO_DB_CAPABILITY_TYPE: Record<CapabilityType, string> = {
  [CapabilityType.TEXT_GENERATION]: 'text_generation',
  [CapabilityType.TEXT_COMPLETION]: 'text_completion',
  [CapabilityType.TEXT_EMBEDDING]: 'text_embedding',
  [CapabilityType.IMAGE_GENERATION]: 'image_generation',
  [CapabilityType.IMAGE_EDIT]: 'image_edit',
  [CapabilityType.SPEECH_TO_TEXT]: 'speech_to_text',
  [CapabilityType.TEXT_TO_SPEECH]: 'text_to_speech',
  [CapabilityType.TRANSLATION]: 'translation',
  [CapabilityType.MODERATION]: 'moderation',
};

export const DB_TO_API_CAPABILITY_TYPE: Record<string, CapabilityType> = Object.fromEntries(
  Object.entries(API_TO_DB_CAPABILITY_TYPE).map(([apiValue, dbValue]) => [dbValue, apiValue])
) as Record<string, CapabilityType>;

export const LEGACY_CAPABILITY_ALIASES: Record<string, CapabilityType> = {
  text_generation: CapabilityType.TEXT_GENERATION,
  text_completion: CapabilityType.TEXT_COMPLETION,
  text_embedding: CapabilityType.TEXT_EMBEDDING,
  image_generation: CapabilityType.IMAGE_GENERATION,
  image_edit: CapabilityType.IMAGE_EDIT,
  speech_to_text: CapabilityType.SPEECH_TO_TEXT,
  text_to_speech: CapabilityType.TEXT_TO_SPEECH,
  chat: CapabilityType.TEXT_GENERATION,
  analysis: CapabilityType.TEXT_GENERATION,
  recommendation: CapabilityType.TEXT_GENERATION,
  completion: CapabilityType.TEXT_COMPLETION,
  embedding: CapabilityType.TEXT_EMBEDDING,
  image: CapabilityType.IMAGE_GENERATION,
  'image-generation': CapabilityType.IMAGE_GENERATION,
  'speech-to-text': CapabilityType.SPEECH_TO_TEXT,
  'text-to-speech': CapabilityType.TEXT_TO_SPEECH,
  translation: CapabilityType.TRANSLATION,
  moderation: CapabilityType.MODERATION,
};

export function normalizeCapabilityType(value?: string | null): CapabilityType | '' | string {
  if (!value) return '';
  return LEGACY_CAPABILITY_ALIASES[value] ?? value;
}

export function toDbCapabilityType(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeCapabilityType(value);
  if (!normalized) return undefined;
  return API_TO_DB_CAPABILITY_TYPE[normalized as CapabilityType] ?? normalized;
}

export function toApiCapabilityType(value?: string | null): CapabilityType | string {
  if (!value) return '';
  return DB_TO_API_CAPABILITY_TYPE[value] ?? normalizeCapabilityType(value);
}

export function capabilityLookupValues(value: string): string[] {
  const normalized = normalizeCapabilityType(value);
  const values = new Set<string>([value]);
  if (normalized) values.add(normalized);
  const dbValue = toDbCapabilityType(normalized);
  if (dbValue) values.add(dbValue);
  for (const [alias, target] of Object.entries(LEGACY_CAPABILITY_ALIASES)) {
    if (target === normalized) values.add(alias);
  }
  return Array.from(values);
}
