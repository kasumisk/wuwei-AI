import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  AddAdminFeedbackNoteDto,
  CreateAppFeedbackDto,
  GetAdminFeedbackQueryDto,
  UpdateAdminFeedbackStatusDto,
} from './dto/feedback.dto';

type FeedbackAdminOperator = {
  id?: string;
  username?: string;
  role?: string;
};

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateAppFeedbackDto) {
    const feedback = await this.prisma.appFeedbacks.create({
      data: {
        userId,
        category: dto.category ?? 'general',
        content: dto.content.trim(),
        contact: dto.contact?.trim() || null,
        metadata: (dto.metadata ?? {}) as Prisma.InputJsonObject,
      },
      select: {
        id: true,
        category: true,
        status: true,
        createdAt: true,
      },
    });

    return feedback;
  }

  async findAdminList(query: GetAdminFeedbackQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.AppFeedbacksWhereInput = {};

    if (query.category) {
      where.category = query.category;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.keyword?.trim()) {
      const keyword = query.keyword.trim();
      where.OR = [
        { content: { contains: keyword, mode: 'insensitive' } },
        { contact: { contains: keyword, mode: 'insensitive' } },
        {
          appUsers: {
            is: {
              OR: [
                { id: { equals: keyword } },
                { nickname: { contains: keyword, mode: 'insensitive' } },
                { email: { contains: keyword, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    const [list, total] = await Promise.all([
      this.prisma.appFeedbacks.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          appUsers: {
            select: {
              id: true,
              nickname: true,
              email: true,
              authType: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.appFeedbacks.count({ where }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findAdminOne(id: string) {
    const feedback = await this.prisma.appFeedbacks.findUnique({
      where: { id },
      include: {
        appUsers: {
          select: {
            id: true,
            nickname: true,
            email: true,
            authType: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!feedback) {
      throw new NotFoundException(`Feedback not found: ${id}`);
    }

    return feedback;
  }

  async getAdminStats() {
    const [total, open, reviewing, resolved, closed, byCategory, latest] =
      await Promise.all([
        this.prisma.appFeedbacks.count(),
        this.prisma.appFeedbacks.count({ where: { status: 'open' } }),
        this.prisma.appFeedbacks.count({ where: { status: 'reviewing' } }),
        this.prisma.appFeedbacks.count({ where: { status: 'resolved' } }),
        this.prisma.appFeedbacks.count({ where: { status: 'closed' } }),
        this.prisma.appFeedbacks.groupBy({
          by: ['category'],
          _count: { _all: true },
          orderBy: { _count: { category: 'desc' } },
        }),
        this.prisma.appFeedbacks.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, category: true, createdAt: true },
        }),
      ]);

    return {
      total,
      byStatus: { open, reviewing, resolved, closed },
      byCategory: byCategory.map((item) => ({
        category: item.category,
        count: item._count._all,
      })),
      latest,
    };
  }

  async updateAdminStatus(id: string, dto: UpdateAdminFeedbackStatusDto) {
    await this.ensureFeedbackExists(id);

    return this.prisma.appFeedbacks.update({
      where: { id },
      data: { status: dto.status },
      include: {
        appUsers: {
          select: {
            id: true,
            nickname: true,
            email: true,
            authType: true,
            status: true,
          },
        },
      },
    });
  }

  async addAdminNote(
    id: string,
    dto: AddAdminFeedbackNoteDto,
    operator?: FeedbackAdminOperator,
  ) {
    const current = await this.prisma.appFeedbacks.findUnique({
      where: { id },
      select: { metadata: true },
    });

    if (!current) {
      throw new NotFoundException(`Feedback not found: ${id}`);
    }

    const metadata = this.toMetadataObject(current.metadata);
    const adminNotes = Array.isArray(metadata.adminNotes)
      ? [...metadata.adminNotes]
      : [];

    adminNotes.push({
      id: crypto.randomUUID(),
      content: dto.content.trim(),
      createdAt: new Date().toISOString(),
      operator: {
        id: operator?.id ?? null,
        username: operator?.username ?? null,
        role: operator?.role ?? null,
      },
    });

    metadata.adminNotes = adminNotes;

    return this.prisma.appFeedbacks.update({
      where: { id },
      data: {
        metadata: metadata as Prisma.InputJsonObject,
      },
      include: {
        appUsers: {
          select: {
            id: true,
            nickname: true,
            email: true,
            authType: true,
            status: true,
          },
        },
      },
    });
  }

  private async ensureFeedbackExists(id: string) {
    const exists = await this.prisma.appFeedbacks.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException(`Feedback not found: ${id}`);
    }
  }

  private toMetadataObject(metadata: Prisma.JsonValue | null | undefined) {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return { ...(metadata as Record<string, unknown>) };
    }

    return {} as Record<string, unknown>;
  }
}
