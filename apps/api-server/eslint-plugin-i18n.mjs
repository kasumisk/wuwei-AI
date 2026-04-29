/**
 * ESLint 自定义规则集 — i18n 治理
 *
 * 规则：
 *  no-cjk-literal: 禁止 service / usecase / prompt 文件中出现中日文字符字面量
 *                   （ASCII 字符串放过；i18n JSON / spec / dto 排除）
 *  no-locale-ternary: 禁止形如 `loc === 'en-US' ? ... : ...` 的语言三元判断
 *  no-key-concat:    禁止 cl()/i18n.t() 使用模板字符串拼接 key
 *                     （含 // i18n-allow-dynamic 行注释豁免）
 *  no-cross-module-i18n-import: 禁止跨模块 import 别的模块的 i18n/ 资源
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

/**
 * 判断 CallExpression 是否为 cl(...) 或 *.i18n.t(...) / i18n.t(...) / this.i18n.t(...)
 */
function isI18nCall(node) {
  const callee = node.callee;
  if (!callee) return null;
  // cl(...)
  if (callee.type === 'Identifier' && callee.name === 'cl') return 'cl';
  // xxx.t(...) where receiver name matches /i18n/i
  if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier' && callee.property.name === 't') {
    const obj = callee.object;
    const objName =
      obj?.type === 'Identifier'
        ? obj.name
        : obj?.type === 'MemberExpression' && obj.property?.type === 'Identifier'
          ? obj.property.name
          : null;
    if (objName && /i18n/i.test(objName)) return 'i18n.t';
  }
  return null;
}

const noKeyConcat = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow dynamic i18n key construction via template literals in cl() / i18n.t(); use static keys or add `// i18n-allow-dynamic` to opt out',
    },
    schema: [],
    messages: {
      dynamic:
        'Dynamic i18n key in {{fn}}(`...${expr}...`) breaks static analysis. ' +
        'Use a static key or add a `// i18n-allow-dynamic` comment on the same line.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!isBusinessFile(filename)) return {};
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      CallExpression(node) {
        const fn = isI18nCall(node);
        if (!fn) return;
        const arg0 = node.arguments?.[0];
        if (!arg0) return;
        if (arg0.type !== 'TemplateLiteral') return;
        if (arg0.expressions.length === 0) return; // 静态模板字符串，无 ${}
        // 行内豁免注释：// i18n-allow-dynamic
        const line = node.loc?.start?.line;
        const comments = sourceCode.getAllComments?.() ?? [];
        const allowed = comments.some((c) => {
          if (!c.loc) return false;
          if (c.loc.start.line !== line && c.loc.end.line !== line) return false;
          return /i18n-allow-dynamic/.test(c.value);
        });
        if (allowed) return;
        context.report({
          node: arg0,
          messageId: 'dynamic',
          data: { fn },
        });
      },
    };
  },
};

const noCrossModuleI18nImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow importing i18n resources from a sibling module; use I18nService.t() with the foreign namespace instead',
    },
    schema: [],
    messages: {
      cross:
        'Cross-module i18n import "{{source}}" leaks foreign namespace. ' +
        'Use I18nService.t("<otherModule>.key", locale) instead.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!filename) return {};
    // 提取当前文件所属 module 名（modules/<name>/...）
    const ownMatch = filename.match(/[\\/]modules[\\/]([^\\/]+)[\\/]/);
    const ownModule = ownMatch?.[1] ?? null;
    function check(node, source) {
      if (typeof source !== 'string') return;
      // 只关心相对路径 import
      if (!source.startsWith('.')) return;
      // 必须包含 /i18n/ 或 以 /i18n 结尾
      if (!/(^|\/)i18n(\/|$)/.test(source)) return;
      // 解析目标 module：路径片段中找 modules/<name>
      const segs = source.split('/');
      let targetModule = null;
      for (let i = 0; i < segs.length - 1; i++) {
        if (segs[i] === 'modules') {
          targetModule = segs[i + 1];
          break;
        }
      }
      // 没显式写 modules/ 的相对路径默认视为本模块内部，跳过
      if (!targetModule) return;
      if (ownModule && targetModule === ownModule) return;
      context.report({
        node,
        messageId: 'cross',
        data: { source },
      });
    }
    return {
      ImportDeclaration(node) {
        check(node, node.source?.value);
      },
      ImportExpression(node) {
        if (node.source?.type === 'Literal') check(node, node.source.value);
      },
    };
  },
};

export default {
  rules: {
    'no-cjk-literal': noCjkLiteral,
    'no-locale-ternary': noLocaleTernary,
    'no-key-concat': noKeyConcat,
    'no-cross-module-i18n-import': noCrossModuleI18nImport,
  },
};
