import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 权限模板实体
 * 用于快速为角色分配一组预定义的权限
 */
@Entity('permission_templates')
export class PermissionTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, comment: '模板编码' })
  code: string;

  @Column({ type: 'varchar', length: 100, comment: '模板名称' })
  name: string;

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '模板描述' })
  description: string | null;

  @Column({
    name: 'permission_patterns',
    type: 'simple-array',
    comment: '权限模式列表，支持通配符如 *:list',
  })
  permissionPatterns: string[];

  @Column({
    name: 'is_system',
    type: 'boolean',
    default: false,
    comment: '是否系统模板（不可删除）',
  })
  isSystem: boolean;

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date;
}
