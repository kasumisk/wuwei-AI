'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  foodLibraryClientAPI,
  type FoodLibraryItem,
  type FoodCategory,
} from '@/lib/api/food-library';

interface UseFoodLibraryOptions {
  initialCategories?: FoodCategory[];
  initialPopularFoods?: FoodLibraryItem[];
}

export function useFoodLibrary({
  initialCategories = [],
  initialPopularFoods = [],
}: UseFoodLibraryOptions = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FoodLibraryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [categoryFoods, setCategoryFoods] = useState<FoodLibraryItem[]>([]);
  const [loadingCategory, setLoadingCategory] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [categoryError, setCategoryError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    try {
      const data = await foodLibraryClientAPI.search(q, 20);
      setResults(data);
    } catch {
      setResults([]);
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  }, []);

  const onQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) {
        setResults([]);
        return;
      }
      debounceRef.current = setTimeout(() => handleSearch(value), 300);
    },
    [handleSearch]
  );

  const handleCategoryClick = useCallback(
    async (category: string) => {
      if (activeCategory === category) {
        setActiveCategory(null);
        setCategoryFoods([]);
        setCategoryError(false);
        return;
      }
      setActiveCategory(category);
      setLoadingCategory(true);
      setCategoryError(false);
      try {
        const data = await foodLibraryClientAPI.getPopular(category, 50);
        setCategoryFoods(data);
      } catch {
        setCategoryFoods([]);
        setCategoryError(true);
      } finally {
        setLoadingCategory(false);
      }
    },
    [activeCategory]
  );

  const retryCategory = useCallback(async () => {
    if (!activeCategory) return;
    setLoadingCategory(true);
    setCategoryError(false);
    try {
      const data = await foodLibraryClientAPI.getPopular(activeCategory, 50);
      setCategoryFoods(data);
    } catch {
      setCategoryFoods([]);
      setCategoryError(true);
    } finally {
      setLoadingCategory(false);
    }
  }, [activeCategory]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setResults([]);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const showSearchResults = query.trim().length > 0;
  const showCategoryFoods = !!activeCategory && !showSearchResults;
  const displayFoods = showSearchResults
    ? results
    : showCategoryFoods
      ? categoryFoods
      : initialPopularFoods;

  return {
    query,
    onQueryChange,
    clearSearch,
    searching,
    results,
    activeCategory,
    categoryFoods,
    loadingCategory,
    handleCategoryClick,
    categories: initialCategories,
    showSearchResults,
    showCategoryFoods,
    displayFoods,
    searchError,
    categoryError,
    retryCategory,
  };
}
