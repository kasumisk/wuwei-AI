/**
 * 通用 ID 类型
 */
export type ID = string | number;

/**
 * 时间戳类型
 */
export type Timestamp = string | Date | number;

/**
 * 基础实体接口
 */
export interface BaseEntity {
  id: ID;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  deletedAt?: Timestamp;
}

/**
 * 选项接口
 */
export interface Option<T = any> {
  label: string;
  value: T;
  disabled?: boolean;
  children?: Option<T>[];
}

/**
 * 字典项接口
 */
export interface DictItem {
  key: string;
  value: string;
  label: string;
  description?: string;
  order?: number;
}

/**
 * 树形节点接口
 */
export interface TreeNode<T = any> {
  id: ID;
  label: string;
  children?: TreeNode<T>[];
  data?: T;
  parent?: TreeNode<T>;
}

/**
 * 排序方向
 */
export type SortOrder = 'asc' | 'desc' | 'ASC' | 'DESC';

/**
 * 排序参数
 */
export interface SortParams {
  field: string;
  order: SortOrder;
}

/**
 * 文件信息
 */
export interface FileInfo {
  name: string;
  size: number;
  type: string;
  url?: string;
  path?: string;
  uploadedAt?: Timestamp;
}

/**
 * 环境类型
 */
export type Environment = 'development' | 'test' | 'production';
