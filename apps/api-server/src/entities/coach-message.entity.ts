import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { CoachConversation } from './coach-conversation.entity';

@Entity('coach_messages')
@Index(['conversationId', 'createdAt'])
export class CoachMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId: string;

  @Column({ type: 'varchar', length: 20 })
  role: string; // 'user' | 'assistant'

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'tokens_used', type: 'int', default: 0 })
  tokensUsed: number;

  @ManyToOne(() => CoachConversation, (conv) => conv.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation: CoachConversation;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
