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
