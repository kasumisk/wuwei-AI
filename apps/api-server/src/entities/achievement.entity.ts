import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('achievements')
export class Achievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  icon: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  category: string;

  @Column({ type: 'int' })
  threshold: number;

  @Column({ name: 'reward_type', type: 'varchar', length: 30, nullable: true })
  rewardType: string;

  @Column({ name: 'reward_value', type: 'int', default: 0 })
  rewardValue: number;
}
