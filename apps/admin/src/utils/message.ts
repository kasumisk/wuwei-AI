import { message } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

// 全局 message 实例
let globalMessageInstance: MessageInstance | null = null;

// 设置全局 message 实例
export const setGlobalMessage = (messageInstance: MessageInstance) => {
  globalMessageInstance = messageInstance;
};

// 获取全局 message 实例
export const getGlobalMessage = (): MessageInstance => {
  if (!globalMessageInstance) {
    // 如果没有设置全局实例，使用静态方法作为降级
    return message;
  }
  return globalMessageInstance;
};

// 导出方便使用的方法
export const globalMessage = {
  success: (content: string) => getGlobalMessage().success(content),
  error: (content: string) => getGlobalMessage().error(content),
  warning: (content: string) => getGlobalMessage().warning(content),
  info: (content: string) => getGlobalMessage().info(content),
  loading: (content: string) => getGlobalMessage().loading(content),
};

export default globalMessage;