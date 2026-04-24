'use client';

/**
 * 低置信度食物列表编辑器（置信度驱动 V1）
 *
 * 用户可编辑：食物名、克数（必填）；增加/删除条目。
 * 提交时向上抛出 RefinedFoodInput[]（estimatedWeightGrams 必填）。
 *
 * 设计变更 v1.1：去掉「份量描述」字段，只用克数，防止 AI 对非结构化
 * 份量描述（如"半只+米饭"）产生幻觉。
 */

import { useState, useCallback, useMemo } from 'react';
import type { AnalyzedFoodItemLite, RefinedFoodInput } from '@/types/food';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface FoodEditListProps {
  initialFoods: AnalyzedFoodItemLite[];
  /** 提交时调用，传入清洗后的 RefinedFoodInput[] */
  onSubmit: (foods: RefinedFoodInput[], userNote?: string) => void;
  /** 取消按钮点击 */
  onCancel?: () => void;
  /** 外部正在提交中，禁用表单 */
  submitting?: boolean;
}

interface EditableFoodRow {
  localKey: string;
  originalId?: string;
  name: string;
  weight: string; // 文本输入，提交时转为 number
  uncertaintyHints?: string[];
  confidence?: number;
}

function toRow(lite: AnalyzedFoodItemLite, idx: number): EditableFoodRow {
  return {
    localKey: `${lite.id}-${idx}`,
    originalId: lite.id,
    name: lite.name ?? '',
    weight:
      typeof lite.estimatedWeightGrams === 'number' && lite.estimatedWeightGrams > 0
        ? String(lite.estimatedWeightGrams)
        : '',
    uncertaintyHints: lite.uncertaintyHints,
    confidence: lite.confidence,
  };
}

const MAX_ROWS = 20;

// 常用克数预设
const WEIGHT_PRESETS = [50, 100, 150, 200, 300];

export function FoodEditList({
  initialFoods,
  onSubmit,
  onCancel,
  submitting,
}: FoodEditListProps) {
  const [rows, setRows] = useState<EditableFoodRow[]>(() =>
    (initialFoods ?? []).map(toRow)
  );
  const [userNote, setUserNote] = useState('');

  const updateRow = useCallback((key: string, patch: Partial<EditableFoodRow>) => {
    setRows((prev) => prev.map((r) => (r.localKey === key ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback((key: string) => {
    setRows((prev) => prev.filter((r) => r.localKey !== key));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => {
      if (prev.length >= MAX_ROWS) return prev;
      return [
        ...prev,
        {
          localKey: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: '',
          weight: '',
        },
      ];
    });
  }, []);

  const validation = useMemo(() => {
    if (rows.length === 0) return { ok: false, message: '至少保留一个食物' };
    if (rows.length > MAX_ROWS) return { ok: false, message: `最多 ${MAX_ROWS} 个食物` };
    for (const r of rows) {
      if (!r.name.trim()) return { ok: false, message: '食物名称不能为空' };
      if (!r.weight.trim()) return { ok: false, message: `「${r.name || '食物'}」请填写克数` };
      const n = Number(r.weight);
      if (!Number.isFinite(n) || n < 1 || n > 5000) {
        return { ok: false, message: `「${r.name || '食物'}」克数需为 1-5000 的整数` };
      }
    }
    return { ok: true, message: '' };
  }, [rows]);

  const handleSubmit = useCallback(() => {
    if (!validation.ok || submitting) return;
    const cleaned: RefinedFoodInput[] = rows.map((r) => ({
      name: r.name.trim(),
      estimatedWeightGrams: Math.round(Number(r.weight)),
      originalId: r.originalId,
    }));
    onSubmit(cleaned, userNote.trim() || undefined);
  }, [rows, userNote, validation.ok, submitting, onSubmit]);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {rows.map((row, idx) => (
          <div
            key={row.localKey}
            className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 space-y-2">
                {/* 食物名 */}
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    食物 #{idx + 1}
                    {typeof row.confidence === 'number' && (
                      <span className={`ml-2 ${row.confidence >= 0.7 ? 'text-gray-400' : 'text-amber-500'}`}>
                        {row.confidence >= 0.7 ? '可能是' : '不太确定'}·{Math.round(row.confidence * 100)}%
                      </span>
                    )}
                  </label>
                  <Input
                    value={row.name}
                    placeholder="例如：米饭"
                    onChange={(e) => updateRow(row.localKey, { name: e.target.value })}
                    disabled={submitting}
                  />
                </div>

                {/* 克数 */}
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    克数 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={5000}
                      value={row.weight}
                      placeholder="请填写克数"
                      className="w-28"
                      onChange={(e) => updateRow(row.localKey, { weight: e.target.value })}
                      disabled={submitting}
                    />
                    <span className="text-sm text-gray-400">克</span>
                    {/* 快速预设 */}
                    <div className="flex gap-1">
                      {WEIGHT_PRESETS.map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => updateRow(row.localKey, { weight: String(w) })}
                          disabled={submitting}
                          className="rounded border border-gray-200 px-1.5 py-0.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {row.uncertaintyHints && row.uncertaintyHints.length > 0 && (
                  <p className="text-xs text-amber-600">
                    AI 提示：{row.uncertaintyHints.join('；')}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => removeRow(row.localKey)}
                disabled={submitting || rows.length <= 1}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`删除食物 ${idx + 1}`}
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={submitting || rows.length >= MAX_ROWS}
        >
          + 添加食物
        </Button>
        <span className="text-xs text-gray-400">
          {rows.length}/{MAX_ROWS}
        </span>
      </div>

      <div>
        <label className="mb-1 block text-xs text-gray-500">备注（可选）</label>
        <Input
          value={userNote}
          placeholder="例如：今天饭量比平时大一些"
          maxLength={200}
          onChange={(e) => setUserNote(e.target.value)}
          disabled={submitting}
        />
      </div>

      {!validation.ok && (
        <p className="text-sm text-red-600" role="alert">
          {validation.message}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!validation.ok || submitting}
          className="flex-1"
        >
          {submitting ? '重新分析中...' : '确认并分析'}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
          >
            取消
          </Button>
        )}
      </div>
    </div>
  );
}
