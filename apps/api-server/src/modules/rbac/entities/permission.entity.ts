import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { RolePermission } from './role-permission.entity';

/**
 * 权限类型枚举
 */
export enum PermissionType {
  MENU = 'menu',
  OPERATION = 'operation',
}

/**
 * 权限状态枚举
 */
export enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * HTTP 方法枚举
 */
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
}

/**
 * RBAC 权限实体
 * 统一控制前端展示和后端访问
 */
@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true, comment: '权限编码' })
  code: string;

  @Column({ type: 'varchar', length: 100, comment: '权限名称' })
  name: string;

  @Column({
    type: 'enum',
    enum: PermissionType,
    comment: '权限类型: menu-菜单权限, operation-操作权限',
  })
  type: PermissionType;

  @Column({
    type: 'enum',
    enum: HttpMethod,
    nullable: true,
    comment: 'HTTP方法（operation类型时有效）',
  })
  action: HttpMethod | null;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    comment: 'API资源路径（operation类型时有效）',
  })
  resource: string | null;

  @Column({
    name: 'parent_id',
    type: 'uuid',
    nullable: true,
    comment: '父权限ID',
  })
  parentId: string | null;

  @ManyToOne(() => Permission, (p) => p.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Permission | null;

  @OneToMany(() => Permission, (p) => p.parent)
  children: Permission[];

  @Column({ type: 'varchar', length: 50, nullable: true, comment: '图标' })
  icon: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '权限描述' })
  description: string | null;

  @Column({
    type: 'enum',
    enum: PermissionStatus,
    default: PermissionStatus.ACTIVE,
    comment: '权限状态',
  })
  status: PermissionStatus;

  @Column({
    name: 'is_system',
    type: 'boolean',
    default: false,
    comment: '是否系统权限（不可删除）',
  })
  isSystem: boolean;

  @Column({ type: 'int', default: 0, comment: '排序值' })
  sort: number;

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];
}
