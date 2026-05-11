import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  MealRecordedEvent,
} from '../../../../core/events/domain-events';
import { GamificationService } from '../gamification.service';

@Injectable()
export class MealGrowthListener {
  private readonly logger = new Logger(MealGrowthListener.name);

  constructor(private readonly gamificationService: GamificationService) {}

  @OnEvent(DomainEvents.MEAL_RECORDED, { async: true })
  async handleMealRecorded(event: MealRecordedEvent): Promise<void> {
    try {
      await this.gamificationService.updateStreak(event.userId);
      await this.gamificationService.updateChallengeProgress(event.userId);
    } catch (err) {
      this.logger.warn(
        `Meal growth update failed: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }
}
