'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Braces,
  Copy,
  CheckCircle,
  Minimize2,
  Maximize2,
  RefreshCw,
  AlertCircle,
  Download,
  SortAsc,
  Expand,
  Shrink,
  ClipboardPaste,
  FileJson,
  List,
  ChevronRight,
  ChevronDown,
  WrapText,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewMode = 'highlighted' | 'tree' | 'raw';
type IndentSize = 2 | 4 | 8;

// ─── JSON Syntax Highlighter ──────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightJson(json: string): string {
  const escaped = escapeHtml(json);
  return escaped.replace(
    /(&quot;(?:[^&]|&(?!quot;))*&quot;(\s*:)?|&quot;(?:[^&]|&(?!quot;))*&quot;|"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g,
    (match) => {
      const unescaped = match.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (/^"/.test(unescaped) || /^&quot;/.test(match)) {
        const isKey = /:\s*$/.test(unescaped);
        return `<span class="${isKey ? 'jk' : 'js'}">${match}</span>`;
      }
      if (unescaped === 'true' || unescaped === 'false') return `<span class="jb">${match}</span>`;
      if (unescaped === 'null') return `<span class="jn">${match}</span>`;
      if (/^-?\d/.test(unescaped)) return `<span class="jnum">${match}</span>`;
      if (['{', '}', '[', ']'].includes(unescaped)) return `<span class="jbrace">${match}</span>`;
      return `<span class="jp">${match}</span>`;
    }
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function getJsonStats(data: unknown) {
  let keys = 0;
  let maxDepth = 0;
  let arrays = 0;
  let nulls = 0;

  function traverse(val: unknown, depth: number) {
    maxDepth = Math.max(maxDepth, depth);
    if (Array.isArray(val)) {
      arrays++;
      val.forEach((v) => traverse(v, depth + 1));
    } else if (typeof val === 'object' && val !== null) {
      const entries = Object.entries(val as Record<string, unknown>);
      keys += entries.length;
      entries.forEach(([, v]) => traverse(v, depth + 1));
    } else if (val === null) {
      nulls++;
    }
  }
  traverse(data, 1);
  return { keys, depth: maxDepth, arrays, nulls };
}

// ─── Sort Keys ────────────────────────────────────────────────────────────────

function sortKeysDeep(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sortKeysDeep);
  if (typeof val === 'object' && val !== null) {
    return Object.fromEntries(
      Object.keys(val as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeysDeep((val as Record<string, unknown>)[k])])
    );
  }
  return val;
}

// ─── Tree Node ────────────────────────────────────────────────────────────────

function TreeNode({
  data,
  nodeKey,
  depth = 0,
}: {
  data: unknown;
  nodeKey?: string;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isArr = Array.isArray(data);
  const isObj = typeof data === 'object' && data !== null && !isArr;
  const isComplex = isArr || isObj;
  const entries = isObj
    ? Object.entries(data as Record<string, unknown>)
    : isArr
      ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : [];

  const valueEl = () => {
    if (typeof data === 'string') return <span style={{ color: '#86efac' }}>&quot;{data}&quot;</span>;
    if (typeof data === 'number') return <span style={{ color: '#fbbf24' }}>{data}</span>;
    if (typeof data === 'boolean')
      return <span style={{ color: '#c084fc' }}>{String(data)}</span>;
    if (data === null) return <span style={{ color: '#f87171' }}>null</span>;
    return null;
  };

  const keyEl = nodeKey !== undefined && (
    <>
      <span style={{ color: '#7dd3fc' }}>
        {isObj || isArr ? nodeKey : `"${nodeKey}"`}
      </span>
      <span style={{ color: '#6b7280' }}>: </span>
    </>
  );

  if (!isComplex) {
    return (
      <div className="flex items-baseline py-[1px] pl-1">
        {keyEl}
        {valueEl()}
      </div>
    );
  }

  const bOpen = isArr ? '[' : '{';
  const bClose = isArr ? ']' : '}';
  const count = entries.length;

  return (
    <div>
      <div
        className="flex items-center py-[1px] pl-1 cursor-pointer hover:bg-white/5 rounded select-none"
        onClick={() => setOpen(!open)}
      >
        <span className="w-3.5 shrink-0" style={{ color: '#6b7280' }}>
          {open ? (
            <ChevronDown className="w-3 h-3 inline" />
          ) : (
            <ChevronRight className="w-3 h-3 inline" />
          )}
        </span>
        {keyEl}
        <span style={{ color: '#9ca3af' }}>{bOpen}</span>
        {!open && (
          <span style={{ color: '#6b7280' }} className="text-[11px] ml-1">
            {isArr ? `${count} items` : `${count} keys`}
          </span>
        )}
        {!open && <span style={{ color: '#9ca3af' }}>{bClose}</span>}
      </div>
      {open && (
        <>
          <div className="ml-4 border-l border-white/[0.07] pl-1.5">
            {entries.map(([k, v]) => (
              <TreeNode key={k} data={v} nodeKey={isObj ? k : undefined} depth={depth + 1} />
            ))}
          </div>
          <div className="pl-1" style={{ color: '#9ca3af' }}>
            {bClose}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function JsonFormatter() {
  const t = useTranslations('components.jsonFormatter');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [indent, setIndent] = useState<IndentSize>(2);
  const [autoFmt, setAutoFmt] = useState(true);
  const [sortKeys, setSortKeys] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('highlighted');
  const [parsedData, setParsedData] = useState<unknown>(null);
  const [stats, setStats] = useState<ReturnType<typeof getJsonStats> & { size: string } | null>(null);
  const [wordWrap, setWordWrap] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFormat = useCallback(
    (raw: string, spaces: IndentSize, doSort: boolean, compress = false) => {
      setError(null);
      setErrorLine(null);
      if (!raw.trim()) {
        setOutput('');
        setParsedData(null);
        setStats(null);
        return;
      }
      try {
        let parsed = JSON.parse(raw);
        if (doSort) parsed = sortKeysDeep(parsed);
        const formatted = compress ? JSON.stringify(parsed) : JSON.stringify(parsed, null, spaces);
        setOutput(formatted);
        setParsedData(parsed);
        const s = getJsonStats(parsed);
        setStats({
          ...s,
          size:
            formatted.length < 1024
              ? `${formatted.length} B`
              : `${(formatted.length / 1024).toFixed(1)} KB`,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Invalid JSON';
        setError(msg);
        setOutput('');
        setParsedData(null);
        setStats(null);
        const m = msg.match(/position (\d+)/);
        if (m) setErrorLine(raw.substring(0, Number(m[1])).split('\n').length);
      }
    },
    []
  );

  useEffect(() => {
    if (!autoFmt) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doFormat(input, indent, sortKeys), 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [input, indent, sortKeys, autoFmt, doFormat]);

  const copy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (!output) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
    a.download = 'formatted.json';
    a.click();
  };

  const reset = () => {
    setInput('');
    setOutput('');
    setError(null);
    setErrorLine(null);
    setParsedData(null);
    setStats(null);
  };

  const paste = async () => {
    try {
      setInput(await navigator.clipboard.readText());
    } catch {}
  };

  const openFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    new FileReader().onload = (ev) => setInput(ev.target?.result as string);
    new FileReader().readAsText(f);
    // redo:
    const reader = new FileReader();
    reader.onload = (ev) => setInput(ev.target?.result as string);
    reader.readAsText(f);
    e.target.value = '';
  };

  const sample = `{\n  "name": "json-formatter",\n  "version": "2.0.0",\n  "features": ["highlight", "tree-view", "auto-format", "fullscreen"],\n  "author": { "name": "Developer", "active": true },\n  "count": 42,\n  "ratio": 3.14,\n  "data": null\n}`;

  // output panel shared content
  const OutputContent = () => {
    if (error) {
      return (
        <div className="flex items-start gap-3 m-3 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">{t('parseError')}</p>
            <p className="text-xs mt-1 opacity-80">{error}</p>
            {errorLine && <p className="text-xs mt-1 opacity-60">{t('approxLine', { line: errorLine })}</p>}
          </div>
        </div>
      );
    }
    if (!output) {
      return (
        <div className="flex items-center justify-center h-full text-gray-600 text-sm select-none">
          {t('emptyOutput')}
        </div>
      );
    }
    if (viewMode === 'tree' && parsedData !== null) {
      return (
        <div className="overflow-auto h-full font-mono text-xs text-gray-300 p-3 leading-5">
          <TreeNode data={parsedData} depth={0} />
        </div>
      );
    }
    if (viewMode === 'raw') {
      return (
        <textarea
          value={output}
          readOnly
          className={`w-full h-full bg-transparent text-gray-300 font-mono text-xs p-3 resize-none outline-none leading-5 ${wordWrap ? '' : 'whitespace-pre overflow-x-auto'}`}
        />
      );
    }
    return (
      <pre
        className={`overflow-auto h-full font-mono text-xs p-3 leading-5 text-gray-300 ${wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'}`}
        dangerouslySetInnerHTML={{ __html: highlightJson(output) }}
      />
    );
  };

  const OutputToolbar = ({ compact = false }: { compact?: boolean }) => (
    <div className={`flex items-center gap-1.5 shrink-0 ${compact ? 'p-2 border-b border-white/10' : ''}`}>
      {/* stats */}
      {stats && !compact && (
        <div className="flex gap-1 mr-1">
          <Badge className="text-[10px] h-5 px-1.5 py-0 bg-sky-500/15 text-sky-400 border-sky-500/25 hover:bg-sky-500/20">
            {stats.keys} {t('statsKeys')}
          </Badge>
          <Badge className="text-[10px] h-5 px-1.5 py-0 bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/20">
            {t('statsDepth')} {stats.depth}
          </Badge>
          <Badge className="text-[10px] h-5 px-1.5 py-0 bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/20">
            {stats.size}
          </Badge>
        </div>
      )}
      {compact && stats && (
        <span className="text-xs text-gray-500 mr-1">
          {stats.keys} {t('statsKeys')} · {t('statsDepth')} {stats.depth} · {stats.size}
        </span>
      )}
      <div className="flex-1" />
      {/* view mode */}
      <div className="flex bg-white/5 rounded-md overflow-hidden border border-white/10 text-[11px]">
        {([
          ['highlighted', t('viewHighlight'), ''],
          ['tree', t('viewTree'), ''],
          ['raw', t('viewRaw'), ''],
        ] as [ViewMode, string, string][]).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setViewMode(v)}
            className={`px-2 py-0.5 transition-colors ${viewMode === v ? 'bg-white/15 text-sky-400' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* word wrap */}
      <button
        title={t('wordWrap')}
        onClick={() => setWordWrap(!wordWrap)}
        className={`p-1 rounded transition-colors ${wordWrap ? 'text-sky-400' : 'text-gray-600 hover:text-gray-400'}`}
      >
        <WrapText className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={copy}
        disabled={!output}
        title={t('copy')}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors border border-white/10"
      >
        {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copied ? t('copied') : t('copy')}</span>
      </button>
      <button
        onClick={download}
        disabled={!output}
        title={t('downloadJson')}
        className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 disabled:opacity-30 transition-colors border border-white/10"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => setFullscreen(!fullscreen)}
        title={fullscreen ? t('exitFullscreen') : t('fullscreen')}
        className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors border border-white/10"
      >
        {fullscreen ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  return (
    <>
      {/* JSON highlight styles */}
      <style>{`
        .jk   { color: #7dd3fc; }
        .js   { color: #86efac; }
        .jnum { color: #fbbf24; }
        .jb   { color: #c084fc; }
        .jn   { color: #f87171; }
        .jp   { color: #9ca3af; }
        .jbrace { color: #e2e8f0; }
      `}</style>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col" style={{ fontFamily: 'inherit' }}>
          <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 bg-gray-900/70 shrink-0">
            <Braces className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-medium text-gray-200">{t('title')}</span>
            <OutputToolbar compact />
          </div>
          <div className="flex-1 min-h-0">
            <OutputContent />
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Braces className="w-5 h-5 text-amber-500" />
              {t('title')}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {t('description')}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={reset}>
            <RefreshCw className="w-4 h-4 mr-1.5" />
            {t('reset')}
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap bg-(--color-card) items-center gap-x-3 gap-y-2 px-3 py-2 rounded-sm border ">
          {/* indent */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">{t('indent')}</span>
            <div className="flex gap-0.5">
              {([2, 4, 8] as IndentSize[]).map((n) => (
                <button
                  key={n}
                  onClick={() => setIndent(n)}
                  className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                    indent === n
                      ? 'bg-primary text-primary-foreground'
                      : 'border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-4 bg-border" />

          {/* auto format toggle */}
          <button
            onClick={() => setAutoFmt(!autoFmt)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${
              autoFmt
                ? 'bg-primary text-primary-foreground'
                : 'border text-muted-foreground hover:text-foreground'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {t('autoFormat')}
          </button>

          {/* sort keys */}
          <button
            onClick={() => setSortKeys(!sortKeys)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${
              sortKeys
                ? 'bg-primary text-primary-foreground'
                : 'border text-muted-foreground hover:text-foreground'
            }`}
          >
            <SortAsc className="w-3.5 h-3.5" />
            {t('sortKeys')}
          </button>

          <div className="flex-1" />

          {/* file open */}
          <label className="cursor-pointer">
            <input type="file" accept=".json,application/json,text/plain" className="hidden" onChange={openFile} />
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
              <FileJson className="w-3.5 h-3.5" />
              {t('openFile')}
            </span>
          </label>

          <div className="w-px h-4 bg-border" />

          {/* manual format (shown when auto is off) */}
          {!autoFmt && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => doFormat(input, indent, sortKeys)}
              disabled={!input.trim()}
            >
              <Maximize2 className="w-3.5 h-3.5 mr-1" />
              {t('format')}
            </Button>
          )}

          {/* compress */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => doFormat(input, indent, sortKeys, true)}
            disabled={!input.trim()}
          >
            <Minimize2 className="w-3.5 h-3.5 mr-1" />
            {t('compress')}
          </Button>
        </div>

        {/* Editor layout */}
        <div className="grid lg:grid-cols-2 gap-4 bg-(--color-card) p-2 rounded-sm">
          {/* Input panel */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between h-7">
              <span className="text-sm font-medium">{t('inputJson')}</span>
              <div className="flex gap-1">
                <button
                  onClick={paste}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  {t('paste')}
                </button>
                <button
                  onClick={() => setInput(sample)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                >
                  {t('sample')}
                </button>
              </div>
            </div>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('inputPlaceholder')}
              className="font-mono text-xs min-h-[480px] resize-y leading-5"
              spellCheck={false}
            />
            {input && (
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{input.split('\n').length} {t('lines')}</span>
                <span>{input.length} {t('characters')}</span>
              </div>
            )}
          </div>

          {/* Output panel */}
          {!fullscreen && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between h-7">
                <span className="text-sm font-medium">{t('outputResult')}</span>
                <OutputToolbar />
              </div>
              <div className="rounded-lg border border-[--border-color] bg-(--color-card) overflow-hidden flex flex-col min-h-[480px]">
                <OutputContent />
              </div>
            </div>
          )}
          {fullscreen && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between h-7">
                <span className="text-sm font-medium text-muted-foreground">{t('outputResult')}</span>
              </div>
              <div
                onClick={() => setFullscreen(true)}
                className="rounded-lg border border-dashed border-gray-600/40 bg-gray-950/30 min-h-[480px] flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-gray-500/50 transition-colors"
              >
                <Expand className="w-8 h-8 text-gray-600" />
                <span className="text-sm text-gray-600">{t('currentFullscreen')}</span>
                <button
                  onClick={() => setFullscreen(false)}
                  className="text-xs text-sky-500 hover:text-sky-400 underline"
                >
                  {t('exitFullscreenAction')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
