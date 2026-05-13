import { CAPABILITY_TYPES, CapabilityType, normalizeCapabilityType } from '@ai-platform/shared';

export { normalizeCapabilityType };

export type ModelCapabilityOption = {
  label: string;
  value: string;
  color: string;
  description: string;
  submitValue?: CapabilityType;
};

export const MODEL_CAPABILITY_VISION_TEXT_VALUE = 'vision.text_generation';

export const VISION_TEXT_MODEL_CAPABILITY_OPTION: ModelCapabilityOption = {
  label: '视觉理解 / 多模态分析',
  value: MODEL_CAPABILITY_VISION_TEXT_VALUE,
  submitValue: CapabilityType.TEXT_GENERATION,
  color: 'purple',
  description: '图片识别、食物图片分析、Qwen VL / GPT-4o Vision 等多模态 Chat 模型',
};

export const MODEL_CAPABILITY_GROUPS: Array<{
  label: string;
  options: ModelCapabilityOption[];
}> = [
  {
    label: '文本',
    options: [
      {
        label: '文本生成 / Chat',
        value: CapabilityType.TEXT_GENERATION,
        color: 'blue',
        description: '对话、食物文本分析、营养补全、菜谱生成',
      },
      {
        label: '文本补全',
        value: CapabilityType.TEXT_COMPLETION,
        color: 'geekblue',
        description: '旧式 completion API',
      },
    ],
  },
  {
    label: '向量与检索',
    options: [
      {
        label: '文本嵌入',
        value: CapabilityType.TEXT_EMBEDDING,
        color: 'cyan',
        description: 'Embedding / 向量检索',
      },
    ],
  },
  {
    label: '图像与多模态',
    options: [
      VISION_TEXT_MODEL_CAPABILITY_OPTION,
      {
        label: '图像生成',
        value: CapabilityType.IMAGE_GENERATION,
        color: 'purple',
        description: '图片生成模型',
      },
      {
        label: '图像编辑',
        value: CapabilityType.IMAGE_EDIT,
        color: 'magenta',
        description: '图片编辑模型',
      },
    ],
  },
  {
    label: '语音',
    options: [
      {
        label: '语音转文字',
        value: CapabilityType.SPEECH_TO_TEXT,
        color: 'orange',
        description: 'ASR / transcription',
      },
      {
        label: '文字转语音',
        value: CapabilityType.TEXT_TO_SPEECH,
        color: 'volcano',
        description: 'TTS',
      },
    ],
  },
  {
    label: '安全与翻译',
    options: [
      {
        label: '翻译',
        value: CapabilityType.TRANSLATION,
        color: 'green',
        description: '多语言翻译',
      },
      {
        label: '内容审核',
        value: CapabilityType.MODERATION,
        color: 'red',
        description: '安全审核、合规审核',
      },
    ],
  },
];

export const MODEL_CAPABILITY_OPTIONS = MODEL_CAPABILITY_GROUPS.flatMap((group) => group.options);

export const MODEL_CAPABILITY_SELECT_OPTIONS = MODEL_CAPABILITY_OPTIONS.map((option) => ({
  label: `${option.label} (${option.value})`,
  value: option.value,
}));

export const MODEL_CAPABILITY_GROUPED_SELECT_OPTIONS = MODEL_CAPABILITY_GROUPS.map((group) => ({
  label: group.label,
  options: group.options.map((option) => ({
    label: `${option.label} (${option.value})`,
    value: option.value,
  })),
}));

export const MODEL_CAPABILITY_VALUE_ENUM = {
  '': { text: '全部' },
  ...Object.fromEntries(
    MODEL_CAPABILITY_OPTIONS.map((option) => [option.value, { text: option.label }])
  ),
};

export function shouldUseVisionTextOption(
  value?: string | null,
  features?: { vision?: boolean } | null
): boolean {
  return (
    value === MODEL_CAPABILITY_VISION_TEXT_VALUE ||
    (normalizeCapabilityType(value) === CapabilityType.TEXT_GENERATION && features?.vision === true)
  );
}

export function isVisionModelCapabilitySelection(value?: string | null): boolean {
  return value === MODEL_CAPABILITY_VISION_TEXT_VALUE;
}

export function getModelCapabilityOption(
  value?: string | null,
  features?: { vision?: boolean } | null
) {
  if (shouldUseVisionTextOption(value, features)) {
    return VISION_TEXT_MODEL_CAPABILITY_OPTION;
  }

  const exactOption = MODEL_CAPABILITY_OPTIONS.find((option) => option.value === value);
  if (exactOption) return exactOption;

  const normalized = normalizeCapabilityType(value);
  return MODEL_CAPABILITY_OPTIONS.find((option) => option.value === normalized);
}

export function toModelCapabilitySubmitValue(value?: string | null): string {
  const option = MODEL_CAPABILITY_OPTIONS.find((item) => item.value === value);
  const normalized = option?.submitValue ?? normalizeCapabilityType(value);
  return CAPABILITY_TYPES.includes(normalized as CapabilityType)
    ? normalized
    : CapabilityType.TEXT_GENERATION;
}
