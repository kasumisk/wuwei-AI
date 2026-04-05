'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Regex, Copy, CheckCircle, RefreshCw, AlertCircle, Info, Replace, Code, ArrowRightLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

interface MatchResult {
  match: string;
  index: number;
  groups?: string[];
}

const COMMON_PATTERNS = [
  { labelKey: 'patterns.email', pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}' },
  { labelKey: 'patterns.phone', pattern: '1[3-9]\\d{9}' },
  { labelKey: 'patterns.url', pattern: 'https?://[^\\s]+' },
  { labelKey: 'patterns.ip', pattern: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}' },
  { labelKey: 'patterns.idCard', pattern: '\\d{17}[\\dXx]' },
  { labelKey: 'patterns.date', pattern: '\\d{4}-\\d{2}-\\d{2}' },
  { labelKey: 'patterns.chinese', pattern: '[\\u4e00-\\u9fa5]+' },
  { labelKey: 'patterns.htmlTag', pattern: '<[^>]+>' },
  { labelKey: 'patterns.hexColor', pattern: '#[0-9a-fA-F]{3,8}' },
  { labelKey: 'patterns.number', pattern: '-?\\d+\\.?\\d*' },
  { labelKey: 'patterns.blankLine', pattern: '^\\s*$' },
  { labelKey: 'patterns.password', pattern: '(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}' },
];

type TabType = 'match' | 'replace' | 'codegen';

export function RegexTester() {
  const t = useTranslations('components.regexTester');
  const [pattern, setPattern] = useState('');
  const [testString, setTestString] = useState('');
  const [replaceStr, setReplaceStr] = useState('');
  const [flags, setFlags] = useState({ g: true, i: false, m: false, s: false, u: false });
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('match');

  const flagStr = useMemo(
    () =>
      Object.entries(flags)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(''),
    [flags]
  );

  const result = useMemo(() => {
    if (!pattern || !testString) return null;

    try {
      const regex = new RegExp(pattern, flagStr);
      const matches: MatchResult[] = [];

      if (flags.g) {
        let match;
        while ((match = regex.exec(testString)) !== null) {
          matches.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1).length > 0 ? match.slice(1) : undefined,
          });
          if (match[0].length === 0) regex.lastIndex++;
        }
      } else {
        const match = regex.exec(testString);
        if (match) {
          matches.push({
            match: match[0],
            index: match.index,
            groups: match.slice(1).length > 0 ? match.slice(1) : undefined,
          });
        }
      }

      return { success: true, matches, regex };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : t('invalidPattern'),
        matches: [],
      };
    }
  }, [pattern, testString, flags, flagStr]);

  // Replace result
  const replaceResult = useMemo(() => {
    if (!pattern || !testString || !result?.success) return '';
    try {
      const regex = new RegExp(pattern, flagStr);
      return testString.replace(regex, replaceStr);
    } catch {
      return '';
    }
  }, [pattern, testString, replaceStr, flagStr, result]);

  // Code generation
  const codeSnippets = useMemo(() => {
    if (!pattern) return { js: '', python: '', go: '' };
    const escapedPattern = pattern.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const rawPattern = pattern;
    return {
      js: `const regex = /${rawPattern}/${flagStr};
const matches = text.match(regex);
// 或使用 matchAll
const allMatches = [...text.matchAll(new RegExp('${escapedPattern}', '${flagStr}'))];`,
      python: `import re
pattern = r'${rawPattern}'
flags = ${flags.i ? 're.IGNORECASE' : '0'}${flags.m ? ' | re.MULTILINE' : ''}${flags.s ? ' | re.DOTALL' : ''}
matches = re.findall(pattern, text${flags.i || flags.m || flags.s ? ', flags' : ''})
# 替换
result = re.sub(pattern, '${replaceStr}', text${flags.i || flags.m || flags.s ? ', flags=flags' : ''})`,
      go: `import "regexp"
re := regexp.MustCompile(\`${rawPattern}\`)
matches := re.FindAllString(text, -1)
// 替换
result := re.ReplaceAllString(text, "${replaceStr}")`,
    };
  }, [pattern, flagStr, flags, replaceStr]);

  const highlightedText = useMemo(() => {
    if (!result?.success || result.matches.length === 0) return testString;

    let lastIndex = 0;
    const parts: React.ReactNode[] = [];

    result.matches.forEach((m, i) => {
      if (m.index > lastIndex) {
        parts.push(testString.slice(lastIndex, m.index));
      }
      parts.push(
        <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded">
          {m.match}
        </mark>
      );
      lastIndex = m.index + m.match.length;
    });

    if (lastIndex < testString.length) {
      parts.push(testString.slice(lastIndex));
    }

    return parts;
  }, [testString, result]);

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleReset = () => {
    setPattern('');
    setTestString('');
    setReplaceStr('');
    setFlags({ g: true, i: false, m: false, s: false, u: false });
  };

  const applyCommonPattern = (p: string) => {
    setPattern(p);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Regex className="w-7 h-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" onClick={handleReset}>
          <RefreshCw className="w-4 h-4 mr-2" />
          {t('clearButton')}
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Pattern & Test String */}
        <div className="lg:col-span-2 space-y-6">
          {/* Pattern Input */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t('pattern')}</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyText(`/${pattern}/${flagStr}`)}
                  disabled={!pattern}
                >
                  {copied === `/${pattern}/${flagStr}` ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2 text-green-500" />
                      {t('copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      {t('copy')}
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-lg">/</span>
                <Input
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder={t('patternPlaceholder')}
                  className="font-mono flex-1"
                />
                <span className="text-muted-foreground font-mono text-lg">/</span>
                <span className="font-mono text-muted-foreground min-w-[2rem]">{flagStr}</span>
              </div>

              {/* Flags */}
              <div className="flex items-center gap-4 flex-wrap">
                {([
                  ['g', 'flagGlobal'],
                  ['i', 'flagCaseInsensitive'],
                  ['m', 'flagMultiline'],
                  ['s', 'flagDotAll'],
                  ['u', 'flagUnicode'],
                ] as const).map(([key, labelKey]) => (
                  <div key={key} className="flex items-center gap-2">
                    <Switch
                      id={`flag-${key}`}
                      checked={flags[key]}
                      onCheckedChange={(v) => setFlags({ ...flags, [key]: v })}
                    />
                    <Label htmlFor={`flag-${key}`} className="text-sm">
                      {key} ({t(labelKey)})
                    </Label>
                  </div>
                ))}
              </div>

              {/* Error */}
              {result && !result.success && (
                <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {result.error}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Test String */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('testText')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={testString}
                onChange={(e) => setTestString(e.target.value)}
                placeholder={t('testTextPlaceholder')}
                className="font-mono text-sm min-h-[200px] resize-none"
              />
            </CardContent>
          </Card>

          {/* Highlighted Result */}
          {testString && result?.success && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  {t('matchHighlight')}
                  <span className="text-sm font-normal text-muted-foreground">
                    {t('matchCount', { count: result.matches.length })}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-muted rounded-lg font-mono text-sm whitespace-pre-wrap break-all">
                  {highlightedText}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Results & Common Patterns */}
        <div className="space-y-6">
          {/* Tab Switcher */}
          <div className="flex gap-1 bg-muted p-1 rounded-lg">
            {([
              { id: 'match', labelKey: 'tabMatch', icon: Regex },
              { id: 'replace', labelKey: 'tabReplace', icon: Replace },
              { id: 'codegen', labelKey: 'tabCodeGen', icon: Code },
            ] as const).map(({ id, labelKey, icon: Icon }) => (
              <Button
                key={id}
                variant={activeTab === id ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab(id)}
                className={cn('flex-1', activeTab !== id && 'hover:bg-background')}
              >
                <Icon className="w-3.5 h-3.5 mr-1" />
                {t(labelKey)}
              </Button>
            ))}
          </div>

          {/* Match Tab */}
          {activeTab === 'match' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('matchResult')}</CardTitle>
              </CardHeader>
              <CardContent>
                {result?.success && result.matches.length > 0 ? (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {result.matches.map((m, i) => (
                      <div
                        key={i}
                        className="p-2 bg-muted rounded text-sm font-mono cursor-pointer hover:bg-muted/80 transition-colors"
                        onClick={() => copyText(m.match)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">#{i + 1}</span>
                          <span className="text-xs text-muted-foreground">{t('matchPosition')}: {m.index}</span>
                        </div>
                        <div className="mt-1 break-all">{m.match}</div>
                        {m.groups && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t('captureGroup')}: {m.groups.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    {!pattern || !testString
                      ? t('noInput')
                      : result?.success
                        ? t('noMatch')
                        : t('matchError')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Replace Tab */}
          {activeTab === 'replace' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4" />
                  {t('replaceTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm">{t('replaceWith')}</Label>
                  <Input
                    value={replaceStr}
                    onChange={(e) => setReplaceStr(e.target.value)}
                    placeholder={t('replacePlaceholder')}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('captureHint')}
                  </p>
                </div>
                {replaceResult && pattern && testString && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground">{t('replaceResult')}</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyText(replaceResult)}
                      >
                        {copied === replaceResult ? (
                          <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>
                    <div className="p-3 bg-muted rounded-lg font-mono text-sm whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
                      {replaceResult}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Code Generation Tab */}
          {activeTab === 'codegen' && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Code className="w-4 h-4" />
                  {t('codeGen')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {pattern ? (
                  <>
                    {([
                      { lang: 'JavaScript', code: codeSnippets.js },
                      { lang: 'Python', code: codeSnippets.python },
                      { lang: 'Go', code: codeSnippets.go },
                    ] as const).map(({ lang, code }) => (
                      <div key={lang} className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">{lang}</Label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyText(code)}
                            className="h-6 px-2"
                          >
                            {copied === code ? (
                              <CheckCircle className="w-3 h-3 text-green-500" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </Button>
                        </div>
                        <pre className="p-3 bg-muted rounded-lg font-mono text-xs overflow-x-auto whitespace-pre">
                          {code}
                        </pre>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    {t('enterPatternFirst')}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Common Patterns */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('commonPatterns')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {COMMON_PATTERNS.map((p) => (
                  <Button
                    key={p.labelKey}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start font-normal h-8"
                    onClick={() => applyCommonPattern(p.pattern)}
                  >
                    <span className="truncate">{t(p.labelKey)}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <div className="flex gap-2 text-sm text-muted-foreground">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground mb-1">{t('tipsTitle')}</p>
                  <ul className="space-y-1 text-xs">
                    <li>• {t('tipEscape')}</li>
                    <li>• {t('tipClickPattern')}</li>
                    <li>• {t('tipClickMatch')}</li>
                    <li>• {t('tipReplace')}</li>
                    <li>• {t('tipDotAll')}</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
