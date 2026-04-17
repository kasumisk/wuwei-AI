'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  useAnalysisHistory,
  useFoodAnalysis,
} from '@/features/food-analysis/hooks/use-food-analysis';
import { useSubscription } from '@/features/subscription/hooks/use-subscription';
import { LocalizedLink } from '@/components/common/localized-link';
import { useLocalizedRouter } from '@/lib/hooks/use-localized-router';
import { useToast } from '@/lib/hooks/use-toast';
import { MEAL_LABELS } from '@/lib/constants/food';
import type { AnalysisHistoryItem } from '@/types/food';

type FilterType = 'all' | 'text' | 'image';

const filterLabels: Record<FilterType, string> = {
  all: '全部',
  image: '图片分析',
  text: '文字分析',
};

const decisionColors: Record<string, string> = {
  SAFE: 'bg-green-100 text-green-800',
  OK: 'bg-yellow-100 text-yellow-800',
  LIMIT: 'bg-orange-100 text-orange-800',
  AVOID: 'bg-red-100 text-red-800',
};

const decisionLabels: Record<string, string> = {
  SAFE: '放心吃',
  OK: '注意量',
  LIMIT: '少吃',
  AVOID: '不建议',
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  if (days === 1) {
    return `昨天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  if (days < 7) {
    return `${days}天前`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function HistoryPage() {
  const router = useRouter();
  const { isFree } = useSubscription();
  const [filter, setFilter] = useState<FilterType>('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isFetching } = useAnalysisHistory({
    page,
    pageSize,
    inputType: filter === 'all' ? undefined : filter,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  const handleFilterChange = useCallback((newFilter: FilterType) => {
    setFilter(newFilter);
    setPage(1); // 切换筛选时重置页码
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center justify-between px-6 py-4 max-w-lg mx-auto">
          <div className="flex items-center">
            <button
              onClick={() => router.back()}
              className="mr-4 text-foreground/70 hover:text-foreground"
              aria-label="返回"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
            <h1 className="text-xl font-extrabold font-headline tracking-tight">分析历史</h1>
          </div>
          <span className="text-xs text-muted-foreground">{total > 0 ? `共 ${total} 条` : ''}</span>
        </div>
      </nav>

      <main className="px-6 py-4 max-w-lg mx-auto pb-32">
        {/* Filter Tabs */}
        <div className="flex gap-2 mb-5">
          {(Object.entries(filterLabels) as [FilterType, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => handleFilterChange(key)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                filter === key
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Loading State — Skeleton */}
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card rounded-xl p-4 space-y-3 animate-pulse">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-5 bg-muted rounded-full" />
                    <div className="w-8 h-4 bg-muted rounded" />
                  </div>
                  <div className="w-16 h-4 bg-muted rounded" />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="flex gap-2">
                      <div className="w-16 h-4 bg-muted rounded" />
                      <div className="w-12 h-4 bg-muted rounded" />
                    </div>
                  </div>
                  <div className="w-14 h-7 bg-muted rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="28"
                height="28"
                className="text-muted-foreground"
              >
                <path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">暂无分析记录</p>
              <p className="text-xs text-muted-foreground mt-1">
                {filter === 'text'
                  ? '还没有文字分析记录，试试在分析页输入文字描述'
                  : filter === 'image'
                    ? '还没有图片分析记录，试试拍照分析食物'
                    : '去分析页拍照或输入文字，记录你的饮食'}
              </p>
            </div>
            <LocalizedLink
              href="/analyze"
              className="mt-2 px-6 py-2.5 bg-primary text-primary-foreground text-sm font-bold rounded-full active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
              asButton
            >
              开始记录
            </LocalizedLink>
          </div>
        )}

        {/* History List */}
        {!isLoading && items.length > 0 && (
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={item.id}>
                <HistoryItem item={item} />
                {/* 免费用户：第3条后插入 inline CTA */}
                {isFree && index === 2 && items.length > 3 && (
                  <div className="mt-3 bg-gradient-to-r from-primary/5 to-violet-500/5 border border-primary/10 rounded-xl p-3.5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <svg
                        className="w-4 h-4 text-primary"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                        />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold">升级查看全部记录和趋势分析</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        跟踪你的饮食进步，发现改善机会
                      </p>
                    </div>
                    <LocalizedLink
                      href="/pricing"
                      className="text-xs text-primary font-bold shrink-0 px-3 py-1.5 rounded-full bg-primary/10"
                    >
                      升级
                    </LocalizedLink>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 免费用户历史受限提示 */}
        {!isLoading && isFree && total > 0 && (
          <div className="mt-4 bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/15 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold">免费版仅显示最近 3 条记录</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  升级后可查看全部历史、周报月报和饮食趋势
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground pl-[52px]">
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                完整历史
              </span>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                趋势分析
              </span>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1">
                <svg className="w-3 h-3 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                数据导出
              </span>
            </div>
            <LocalizedLink
              href="/pricing"
              className="block w-full text-center bg-primary text-primary-foreground text-sm font-bold py-2.5 rounded-xl active:scale-[0.97] transition-all"
              asButton
            >
              升级 Pro · ¥19.9/月
            </LocalizedLink>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="px-4 py-2 bg-muted rounded-full text-sm font-medium disabled:opacity-30 active:scale-[0.97] transition-all"
            >
              上一页
            </button>
            <span className="text-sm text-muted-foreground">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
              className="px-4 py-2 bg-muted rounded-full text-sm font-medium disabled:opacity-30 active:scale-[0.97] transition-all"
            >
              下一页
            </button>
          </div>
        )}

        {/* Fetching indicator (not initial load) */}
        {isFetching && !isLoading && (
          <div className="flex justify-center mt-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </main>
    </div>
  );
}

/** 单条历史记录（可点击跳转详情 + 长按删除） */
function HistoryItem({ item }: { item: AnalysisHistoryItem }) {
  const { push } = useLocalizedRouter();
  const { toast } = useToast();
  const { deleteAnalysis, isDeletingAnalysis } = useFoodAnalysis();
  const [showActions, setShowActions] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const decisionClass = item.decision
    ? decisionColors[item.decision] || 'bg-muted text-muted-foreground'
    : null;
  const decisionLabel = item.decision ? decisionLabels[item.decision] || item.decision : null;

  const handleClick = () => {
    push(`/history/${item.id}`);
  };

  const handleDelete = async () => {
    try {
      await deleteAnalysis(item.id);
      toast({ title: '已删除', description: '分析记录已删除' });
    } catch {
      toast({ title: '删除失败', description: '请稍后再试', variant: 'destructive' });
    }
    setShowDeleteConfirm(false);
    setShowActions(false);
  };

  return (
    <>
      <div
        className="bg-card rounded-xl p-4 space-y-2 cursor-pointer active:scale-[0.98] transition-all relative group"
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowActions(true);
        }}
      >
        {/* Top: type badge + time + more button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                item.inputType === 'image'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-purple-100 text-purple-700'
              }`}
            >
              {item.inputType === 'image' ? '图片' : '文字'}
            </span>
            {item.mealType && (
              <span className="text-xs text-muted-foreground">
                {MEAL_LABELS[item.mealType] || item.mealType}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
            {/* More button — 移动端始终可见，桌面端 hover 显示 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowActions(!showActions);
              }}
              className="opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 -mr-1 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted"
              aria-label="更多操作"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content preview */}
        <div className="flex items-center gap-3">
          {item.inputType === 'image' && item.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.imageUrl}
              alt="食物"
              className="w-14 h-14 rounded-lg object-cover shrink-0"
              loading="lazy"
            />
          )}
          <div className="flex-1 min-w-0">
            {item.inputType === 'text' && item.inputText && (
              <p className="text-sm line-clamp-2">{item.inputText}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-bold text-primary">{item.totalCalories} kcal</span>
              <span className="text-xs text-muted-foreground">{item.foodCount} 种食物</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {decisionClass && decisionLabel && (
              <span className={`px-2 py-1 rounded-lg text-xs font-bold ${decisionClass}`}>
                {decisionLabel}
              </span>
            )}
            {/* 右箭头提示可点击 */}
            <svg
              className="w-4 h-4 text-muted-foreground/40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>

        {/* 操作菜单（浮层） */}
        {showActions && (
          <div
            className="absolute right-3 top-10 z-10 bg-card shadow-xl border border-border rounded-xl overflow-hidden min-w-[120px] animate-in fade-in slide-in-from-top-1 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                handleClick();
                setShowActions(false);
              }}
              className="w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
            >
              <svg
                className="w-4 h-4 text-muted-foreground"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                <path
                  fillRule="evenodd"
                  d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                  clipRule="evenodd"
                />
              </svg>
              查看详情
            </button>
            <button
              onClick={() => {
                setShowActions(false);
                setShowDeleteConfirm(true);
              }}
              className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              删除
            </button>
          </div>
        )}
      </div>

      {/* 点击外部关闭操作菜单 */}
      {showActions && <div className="fixed inset-0 z-[5]" onClick={() => setShowActions(false)} />}

      {/* 删除确认弹窗 */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[100] bg-black/50 flex items-end justify-center animate-in fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-confirm-title"
        >
          <div className="w-full max-w-lg bg-card rounded-t-3xl p-6 space-y-4 animate-in slide-in-from-bottom duration-200">
            <h3 id="delete-confirm-title" className="text-lg font-bold text-center">
              确认删除
            </h3>
            <p className="text-sm text-muted-foreground text-center">
              删除后无法恢复，确定要删除这条分析记录吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeletingAnalysis}
                className="flex-1 py-3 rounded-2xl bg-muted text-sm font-bold active:scale-[0.97] transition-all"
              >
                取消
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeletingAnalysis}
                className="flex-1 py-3 rounded-2xl bg-red-500 text-white text-sm font-bold active:scale-[0.97] transition-all disabled:opacity-60"
              >
                {isDeletingAnalysis ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
