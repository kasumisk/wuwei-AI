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
import { UserRole } from './user-role.entity';

/**
 * 角色状态枚举
 */
export enum RoleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * 角色实体
 * 支持角色继承（通过 parentId 自引用）
 */
@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, comment: '角色编码' })
  code: string;

  @Column({ type: 'varchar', length: 100, comment: '角色名称' })
  name: string;

  @Column({
    name: 'parent_id',
    type: 'uuid',
    nullable: true,
    comment: '父角色ID（用于角色继承）',
  })
  parentId: string | null;

  @ManyToOne(() => Role, (role) => role.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Role | null;

  @OneToMany(() => Role, (role) => role.parent)
  children: Role[];

  @Column({ type: 'varchar', length: 500, nullable: true, comment: '角色描述' })
  description: string | null;

  @Column({
    type: 'enum',
    enum: RoleStatus,
    default: RoleStatus.ACTIVE,
    comment: '角色状态',
  })
  status: RoleStatus;

  @Column({
    name: 'is_system',
    type: 'boolean',
    default: false,
    comment: '是否系统角色（不可删除）',
  })
  isSystem: boolean;

  @Column({ type: 'int', default: 0, comment: '排序值' })
  sort: number;

  @CreateDateColumn({ name: 'created_at', comment: '创建时间' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', comment: '更新时间' })
  updatedAt: Date;

  @OneToMany(() => RolePermission, (rp) => rp.role)
  rolePermissions: RolePermission[];

  @OneToMany(() => UserRole, (ur) => ur.role)
  userRoles: UserRole[];
}
