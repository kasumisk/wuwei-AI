/**
 * ESLint 自定义规则集 — i18n 治理
 *
 * 规则：
 *  no-cjk-literal: 禁止 service / usecase / prompt 文件中出现中日文字符字面量
 *                   （ASCII 字符串放过；i18n JSON / spec / dto 排除）
 *  no-locale-ternary: 禁止形如 `loc === 'en-US' ? ... : ...` 的语言三元判断
 *
 * 实现方式：ESLint 9 flat config 内联 plugin object。
 */

const CJK_REGEX = /[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/;

/** 文件路径是否属于"业务代码"（应用规则） */
function isBusinessFile(filename) {
  if (!filename) return false;
  if (filename.includes('/i18n/')) return false; // i18n JSON / helper / labels
  if (filename.endsWith('.spec.ts') || filename.endsWith('.test.ts')) return false;
  if (filename.includes('/scripts/seeds/')) return false;
  if (filename.includes('/langchain/')) return false;
  if (filename.includes('/test/')) return false;
  if (filename.endsWith('.json') || filename.endsWith('.md')) return false;
  return true;
}

const noCjkLiteral = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow CJK character literals in business code; use I18nService.t() / cl() / translateEnum() instead',
    },
    schema: [],
    messages: {
      cjk:
        'Do not hardcode CJK text "{{snippet}}" in business code. ' +
        'Move to modules/<module>/i18n/<locale>.json and use cl()/I18nService.t().',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!isBusinessFile(filename)) return {};
    function check(node, value) {
      if (typeof value !== 'string') return;
      if (!CJK_REGEX.test(value)) return;
      context.report({
        node,
        messageId: 'cjk',
        data: {
          snippet: value.slice(0, 24).replace(/\n/g, '\\n'),
        },
      });
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value?.cooked ?? '');
      },
    };
  },
};

const noLocaleTernary = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `locale === "xx-XX" ? ... : ...` ternaries; use cl(key, locale) with i18n JSON',
    },
    schema: [],
    messages: {
      ternary:
        'Avoid locale ternary `{{lhs}} === {{rhs}} ? ...`. ' +
        'Externalize to i18n JSON and use cl()/I18nService.t().',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!isBusinessFile(filename)) return {};
    return {
      ConditionalExpression(node) {
        const test = node.test;
        if (!test || test.type !== 'BinaryExpression') return;
        if (test.operator !== '===' && test.operator !== '==') return;
        const lhs = test.left;
        const rhs = test.right;
        const lhsName =
          lhs?.type === 'Identifier'
            ? lhs.name
            : lhs?.type === 'MemberExpression' && lhs.property?.type === 'Identifier'
              ? lhs.property.name
              : null;
        if (!lhsName || !/locale|lang|loc/i.test(lhsName)) return;
        if (rhs?.type !== 'Literal' || typeof rhs.value !== 'string') return;
        if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(rhs.value)) return;
        context.report({
          node,
          messageId: 'ternary',
          data: { lhs: lhsName, rhs: JSON.stringify(rhs.value) },
        });
      },
    };
  },
};

export default {
  rules: {
    'no-cjk-literal': noCjkLiteral,
    'no-locale-ternary': noLocaleTernary,
  },
};
