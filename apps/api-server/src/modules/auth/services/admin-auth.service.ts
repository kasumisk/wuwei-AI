import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AdminUser } from '../entities/admin-user.entity';
import { AdminLoginDto, AdminAuthResponseDto } from '../dto/admin-auth.dto';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @InjectRepository(AdminUser)
    private adminUserRepo: Repository<AdminUser>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async login(dto: AdminLoginDto): Promise<AdminAuthResponseDto> {
    const user = await this.adminUserRepo.findOne({
      where: { username: dto.username },
      select: ['id', 'username', 'password', 'role', 'status'],
    });

    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    this.logger.log(`Admin login: ${user.username}`);

    const payload = { sub: user.id, type: 'admin' as const, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.adminSecret'),
      expiresIn: (this.configService.get<string>('jwt.adminExpiresIn') || '8h') as any,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  async getProfile(userId: string): Promise<AdminUser> {
    const user = await this.adminUserRepo.findOne({
      where: { id: userId },
      relations: ['userRoles', 'userRoles.role'],
    });
    if (!user) throw new UnauthorizedException('管理员不存在');
    return user;
  }

  async seedSuperAdmin(): Promise<void> {
    const existing = await this.adminUserRepo.findOne({
      where: { username: 'admin' },
    });
    if (existing) return;

    const hashed = await bcrypt.hash('admin123456', 10);
    const admin = this.adminUserRepo.create({
      username: 'admin',
      password: hashed,
      role: 'super_admin' as any,
    });
    await this.adminUserRepo.save(admin);
    this.logger.log('Super admin seeded');
  }
}
