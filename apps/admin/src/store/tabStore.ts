import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TabItem {
  key: string;
  label: string;
  path: string;
  closable?: boolean;
  keepAlive?: boolean; // 是否启用 keep-alive
  timestamp?: number; // 用于触发刷新的时间戳
}

interface TabState {
  tabs: TabItem[];
  activeKey: string;
  
  // Actions
  addTab: (tab: TabItem) => void;
  removeTab: (key: string) => void;
  removeAllTabs: () => void;
  removeOtherTabs: (keepKey: string) => void;
  setActiveTab: (key: string) => void;
  clearTabs: () => void;
  updateTab: (key: string, updates: Partial<TabItem>) => void;
  refreshTab: (key: string) => void; // 刷新特定标签页
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeKey: '',

      addTab: (tab) => {
        const { tabs } = get();
        const existingTab = tabs.find(t => t.key === tab.key);
        
        if (!existingTab) {
          set({
            tabs: [...tabs, tab],
            activeKey: tab.key,
          });
        } else {
          set({ activeKey: tab.key });
        }
      },

      removeTab: (key) => {
        const { tabs, activeKey } = get();
        const newTabs = tabs.filter(tab => tab.key !== key);
        
        let newActiveKey = activeKey;
        if (activeKey === key && newTabs.length > 0) {
          // 如果关闭的是当前激活的标签，切换到上一个或下一个标签
          const currentIndex = tabs.findIndex(tab => tab.key === key);
          const targetIndex = currentIndex > 0 ? currentIndex - 1 : 0;
          newActiveKey = newTabs[targetIndex]?.key || '';
        }
        
        set({
          tabs: newTabs,
          activeKey: newActiveKey,
        });
      },

      removeAllTabs: () => {
        set({
          tabs: [],
          activeKey: '',
        });
      },

      removeOtherTabs: (keepKey) => {
        const { tabs } = get();
        const keepTab = tabs.find(tab => tab.key === keepKey);
        if (keepTab) {
          set({
            tabs: [keepTab],
            activeKey: keepKey,
          });
        }
      },

      setActiveTab: (key) => set({ activeKey: key }),

      clearTabs: () => set({ tabs: [], activeKey: '' }),

      updateTab: (key, updates) => {
        const { tabs } = get();
        const newTabs = tabs.map(tab => 
          tab.key === key ? { ...tab, ...updates } : tab
        );
        set({ tabs: newTabs });
      },

      refreshTab: (key) => {
        // 触发标签页刷新，实际的缓存清理在 KeepAlive 组件中处理
        const { tabs } = get();
        const tab = tabs.find(t => t.key === key);
        if (tab) {
          // 通过更新时间戳来触发组件重新渲染
          set({ 
            tabs: tabs.map(t => 
              t.key === key ? { ...t, timestamp: Date.now() } : t
            )
          });
        }
      },
    }),
    {
      name: 'tab-storage',
    }
  )
);