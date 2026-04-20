'use client';

import Image from 'next/image';
import { LocalizedLink } from '@/components/common/localized-link';
import type { RecipeSummary } from '@/types/food';

/** 难度标签 */
const DIFFICULTY_LABELS = ['', '入门', '简单', '中等', '较难', '专业'];
const DIFFICULTY_COLORS = [
  '',
  'bg-green-50 text-green-600 border-green-200',
  'bg-green-50 text-green-600 border-green-200',
  'bg-amber-50 text-amber-600 border-amber-200',
  'bg-orange-50 text-orange-600 border-orange-200',
  'bg-red-50 text-red-600 border-red-200',
];

function StarRating({ rating, count }: { rating: number | null; count: number }) {
  if (rating === null || count === 0) {
    return <span className="text-[11px] text-muted-foreground">暂无评分</span>;
  }
  return (
    <span className="flex items-center gap-1 text-[11px]">
      <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      <span className="font-bold text-foreground">{rating.toFixed(1)}</span>
      <span className="text-muted-foreground">({count})</span>
    </span>
  );
}

export function RecipeCard({ recipe }: { recipe: RecipeSummary }) {
  const totalTime = (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0);
  const diffLabel = DIFFICULTY_LABELS[recipe.difficulty] || '';
  const diffColor = DIFFICULTY_COLORS[recipe.difficulty] || '';

  return (
    <LocalizedLink href={`/recipes/${recipe.id}`} className="block group">
      <div className="bg-card rounded-md overflow-hidden border border-border/10 hover:border-border/30 transition-all active:scale-[0.99]">
        {/* 图片 */}
        <div className="relative h-40 bg-muted">
          {recipe.imageUrl ? (
            <Image
              src={recipe.imageUrl}
              alt={recipe.name}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 100vw, 50vw"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl text-muted-foreground">
              🍳
            </div>
          )}
          {/* 难度标签 */}
          {diffLabel && (
            <span
              className={`absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5  border ${diffColor}`}
            >
              {diffLabel}
            </span>
          )}
        </div>

        {/* 信息 */}
        <div className="p-3 space-y-1.5">
          <h4 className="text-sm font-bold text-foreground truncate">{recipe.name}</h4>

          {recipe.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {recipe.description}
            </p>
          )}

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {recipe.caloriesPerServing && (
                <span>{Math.round(recipe.caloriesPerServing)} kcal</span>
              )}
              {totalTime > 0 && <span>{totalTime}分钟</span>}
              {recipe.cuisine && <span>{recipe.cuisine}</span>}
            </div>
            <StarRating rating={recipe.averageRating} count={recipe.ratingCount} />
          </div>

          {/* Tags */}
          {recipe.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {recipe.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </LocalizedLink>
  );
}
