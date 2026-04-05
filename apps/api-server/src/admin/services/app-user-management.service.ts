import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser, AppUserStatus } from '../../entities/app-user.entity';
import {
  GetAppUsersQueryDto,
  UpdateAppUserByAdminDto,
} from '../dto/app-user-management.dto';

@Injectable()
export class AppUserManagementService {
  constructor(
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
  ) {}

  /**
   * 获取 App 用户列表（分页）
   */
  async findAll(query: GetAppUsersQueryDto) {
    const { page = 1, pageSize = 10, keyword, authType, status } = query;

    const queryBuilder = this.appUserRepository.createQueryBuilder('user');

    if (keyword) {
      queryBuilder.andWhere(
        '(user.nickname LIKE :keyword OR user.email LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    if (authType) {
      queryBuilder.andWhere('user.authType = :authType', { authType });
    }

    if (status) {
      queryBuilder.andWhere('user.status = :status', { status });
    }

    queryBuilder.orderBy('user.createdAt', 'DESC');

    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取 App 用户详情
   */
  async findOne(id: string) {
    const user = await this.appUserRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    return user;
  }

  /**
   * 更新 App 用户信息（管理员操作）
   */
  async update(id: string, dto: UpdateAppUserByAdminDto) {
    const user = await this.appUserRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    if (dto.status) {
      user.status = dto.status as AppUserStatus;
    }
    if (dto.nickname !== undefined) user.nickname = dto.nickname;
    if (dto.avatar !== undefined) user.avatar = dto.avatar;
    if (dto.email !== undefined) user.email = dto.email;

    const updated = await this.appUserRepository.save(user);
    return updated;
  }

  /**
   * 封禁 App 用户
   */
  async ban(id: string) {
    const user = await this.appUserRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    user.status = AppUserStatus.BANNED;
    await this.appUserRepository.save(user);

    return { message: '用户已封禁' };
  }

  /**
   * 解封 App 用户
   */
  async unban(id: string) {
    const user = await this.appUserRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    if (user.status !== AppUserStatus.BANNED) {
      throw new BadRequestException('用户未被封禁');
    }

    user.status = AppUserStatus.ACTIVE;
    await this.appUserRepository.save(user);

    return { message: '用户已解封' };
  }

  /**
   * 删除 App 用户
   */
  async remove(id: string) {
    const user = await this.appUserRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    await this.appUserRepository.remove(user);

    return { message: '用户已删除' };
  }

  /**
   * 获取 App 用户统计
   */
  async getStatistics() {
    const total = await this.appUserRepository.count();
    const anonymous = await this.appUserRepository.count({
      where: { authType: 'anonymous' as any },
    });
    const google = await this.appUserRepository.count({
      where: { authType: 'google' as any },
    });
    const email = await this.appUserRepository.count({
      where: { authType: 'email' as any },
    });
    const active = await this.appUserRepository.count({
      where: { status: AppUserStatus.ACTIVE },
    });
    const banned = await this.appUserRepository.count({
      where: { status: AppUserStatus.BANNED },
    });

    return {
      total,
      byAuthType: { anonymous, google, email },
      byStatus: { active, banned },
    };
  }
}
