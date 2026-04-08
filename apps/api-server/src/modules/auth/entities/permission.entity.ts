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

export enum PermissionType {
  MENU = 'menu',
  OPERATION = 'operation',
}

export enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
}

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'enum', enum: PermissionType })
  type: PermissionType;

  @Column({ type: 'enum', enum: HttpMethod, nullable: true })
  action: HttpMethod | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  resource: string | null;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => Permission, (p) => p.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Permission | null;

  @OneToMany(() => Permission, (p) => p.parent)
  children: Permission[];

  @Column({ type: 'varchar', length: 50, nullable: true })
  icon: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: PermissionStatus, default: PermissionStatus.ACTIVE })
  status: PermissionStatus;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @Column({ type: 'int', default: 0 })
  sort: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];
}
