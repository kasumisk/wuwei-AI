import { create } from 'zustand';

export interface TabItem {
  key: string;
  label: string;
  path: string;
  closable?: boolean;
  keepAlive?: boolean;
  timestamp?: number;
}

interface TabState {
  tabs: TabItem[];
  activeKey: string;

  // Actions
  addTab: (tab: TabItem) => void;
  /** 移除 tab，返回关闭后应激活的路径（调用方负责 navigate） */
  removeTab: (key: string) => string;
  removeAllTabs: () => void;
  removeOtherTabs: (keepKey: string) => void;
  setActiveTab: (key: string) => void;
  clearTabs: () => void;
  updateTab: (key: string, updates: Partial<TabItem>) => void;
  refreshTab: (key: string) => void;
}

// 移除 persist 中间件，直接使用 create
export const useTabStore = create<TabState>()((set, get) => ({
  tabs: [],
  activeKey: '',

  addTab: (tab) => {
    const { tabs } = get();
    const existingTab = tabs.find((t) => t.key === tab.key);

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
    const newTabs = tabs.filter((tab) => tab.key !== key);

    let newActiveKey = activeKey;
    if (activeKey === key && newTabs.length > 0) {
      const currentIndex = tabs.findIndex((tab) => tab.key === key);
      const targetIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      newActiveKey = newTabs[targetIndex]?.key || '';
    }

    set({
      tabs: newTabs,
      activeKey: newActiveKey,
    });

    // 返回新激活路径，让调用方 navigate
    return newActiveKey;
  },

  removeAllTabs: () => {
    set({
      tabs: [],
      activeKey: '',
    });
  },

  removeOtherTabs: (keepKey) => {
    const { tabs } = get();
    const keepTab = tabs.find((tab) => tab.key === keepKey);
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
    const newTabs = tabs.map((tab) => (tab.key === key ? { ...tab, ...updates } : tab));
    set({ tabs: newTabs });
  },

  refreshTab: (key) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.key === key);
    if (tab) {
      set({
        tabs: tabs.map((t) => (t.key === key ? { ...t, timestamp: Date.now() } : t)),
      });
    }
  },
}));
