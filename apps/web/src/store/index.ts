import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// UI Store - 全局 UI 状态
interface UIState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      (set) => ({
        sidebarOpen: true,
        setSidebarOpen: (open) => set({ sidebarOpen: open }),
        toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      }),
      {
        name: 'ui-storage',
      }
    )
  )
);

// Dismiss Store - 首页卡片 dismiss 状态持久化
interface DismissState {
  dismissedReminder: boolean;
  dismissedCompletion: boolean;
  dismissedGoalTransition: boolean;
  dismissedCollectionCard: boolean;
  setDismissedReminder: (v: boolean) => void;
  setDismissedCompletion: (v: boolean) => void;
  setDismissedGoalTransition: (v: boolean) => void;
  setDismissedCollectionCard: (v: boolean) => void;
  resetAllDismissed: () => void;
}

export const useDismissStore = create<DismissState>()(
  devtools(
    persist(
      (set) => ({
        dismissedReminder: false,
        dismissedCompletion: false,
        dismissedGoalTransition: false,
        dismissedCollectionCard: false,
        setDismissedReminder: (v) => set({ dismissedReminder: v }),
        setDismissedCompletion: (v) => set({ dismissedCompletion: v }),
        setDismissedGoalTransition: (v) => set({ dismissedGoalTransition: v }),
        setDismissedCollectionCard: (v) => set({ dismissedCollectionCard: v }),
        resetAllDismissed: () =>
          set({
            dismissedReminder: false,
            dismissedCompletion: false,
            dismissedGoalTransition: false,
            dismissedCollectionCard: false,
          }),
      }),
      {
        name: 'dismiss-storage',
      }
    )
  )
);
