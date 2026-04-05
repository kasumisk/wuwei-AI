import { Modal } from 'antd';
import type { ModalStaticFunctions } from 'antd/es/modal/confirm';

// 全局 modal 实例
let globalModalInstance: Omit<ModalStaticFunctions, 'warn'> | null = null;

// 设置全局 modal 实例
export const setGlobalModal = (modalInstance: Omit<ModalStaticFunctions, 'warn'>) => {
  globalModalInstance = modalInstance;
};

// 获取全局 modal 实例
export const getGlobalModal = (): Omit<ModalStaticFunctions, 'warn'> => {
  if (!globalModalInstance) {
    // 如果没有设置全局实例，使用静态方法作为降级
    return Modal;
  }
  return globalModalInstance;
};

// 导出方便使用的方法
export const globalModal = {
  info: (config: Parameters<typeof Modal.info>[0]) => getGlobalModal().info(config),
  success: (config: Parameters<typeof Modal.success>[0]) => getGlobalModal().success(config),
  error: (config: Parameters<typeof Modal.error>[0]) => getGlobalModal().error(config),
  warning: (config: Parameters<typeof Modal.warning>[0]) => getGlobalModal().warning(config),
  confirm: (config: Parameters<typeof Modal.confirm>[0]) => getGlobalModal().confirm(config),
};

export default globalModal;