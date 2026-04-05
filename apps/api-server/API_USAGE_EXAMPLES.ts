/**
 * API响应格式使用示例
 * 
 * 本文件展示如何在前后端使用统一的API响应格式
 */

// ==================== 后端示例 ====================

// 1. Controller 直接返回数据(推荐)
import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('示例')
@Controller('examples')
export class ExampleController {
  constructor(private readonly exampleService: ExampleService) {}

  /**
   * 示例1: 获取单个资源
   * 响应会被自动包装为: { code: 200, data: user, message: "操作成功", success: true }
   */
  @Get('users/:id')
  @ApiOperation({ summary: '获取用户信息' })
  async getUser(@Param('id') id: string) {
    return this.exampleService.findUser(id);
  }

  /**
   * 示例2: 获取列表(分页)
   */
  @Get('users')
  @ApiOperation({ summary: '获取用户列表' })
  async getUsers(
    @Query('pageNum') pageNum = 1,
    @Query('pageSize') pageSize = 10,
  ) {
    const [records, total] = await this.exampleService.findUsers(
      pageNum,
      pageSize,
    );

    return {
      records,
      total,
      current: pageNum,
      size: pageSize,
      pages: Math.ceil(total / pageSize),
      orders: [],
    };
  }

  /**
   * 示例3: 创建资源
   */
  @Post('users')
  @ApiOperation({ summary: '创建用户' })
  async createUser(@Body() createUserDto: CreateUserDto) {
    return this.exampleService.createUser(createUserDto);
  }

  /**
   * 示例4: 手动控制响应格式(不推荐,但有时需要)
   */
  @Get('custom')
  @ApiOperation({ summary: '自定义响应' })
  async customResponse() {
    const data = await this.exampleService.getData();

    return {
      code: 200,
      data,
      message: '自定义成功消息',
      success: true,
    };
  }
}

// 2. Service 只返回数据
@Injectable()
export class ExampleService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findUser(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      // 抛出异常,会被全局过滤器捕获并转换为标准错误格式
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  async findUsers(pageNum: number, pageSize: number): Promise<[User[], number]> {
    return this.userRepository.findAndCount({
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    });
  }

  async createUser(dto: CreateUserDto): Promise<User> {
    const user = this.userRepository.create(dto);
    return this.userRepository.save(user);
  }
}

// ==================== 前端示例 ====================

import request from '@/utils/request';
import type { ApiResponse, PageResponse, PageParams } from '@ai-platform/shared';

// 用户类型定义
interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
}

/**
 * 示例1: 获取单个用户
 */
async function getUserExample() {
  try {
    // request.get 会自动解包 data 字段
    const user = await request.get<User>('/api/examples/users/123');
    
    console.log(user.username); // ✅ 直接访问数据
    console.log(user.email);
  } catch (error) {
    // 错误已被拦截器处理,会自动显示错误消息
    console.error('获取用户失败:', error);
  }
}

/**
 * 示例2: 获取分页列表
 */
async function getUserListExample() {
  try {
    const params: PageParams = {
      pageNum: 1,
      pageSize: 10,
    };

    const pageData = await request.get<PageResponse<User>>(
      '/api/examples/users',
      params,
    );

    console.log('用户列表:', pageData.records);
    console.log('总数:', pageData.total);
    console.log('当前页:', pageData.current);
    console.log('总页数:', pageData.pages);

    // 渲染列表
    pageData.records.forEach((user) => {
      console.log(`- ${user.username} (${user.email})`);
    });
  } catch (error) {
    console.error('获取列表失败:', error);
  }
}

/**
 * 示例3: 创建用户
 */
async function createUserExample() {
  try {
    const newUser = await request.post<User>('/api/examples/users', {
      username: 'newuser',
      email: 'newuser@example.com',
      password: 'password123',
    });

    console.log('创建成功:', newUser);
    return newUser;
  } catch (error) {
    console.error('创建失败:', error);
    throw error;
  }
}

/**
 * 示例4: 更新用户
 */
async function updateUserExample(id: string) {
  try {
    const updatedUser = await request.put<User>(`/api/examples/users/${id}`, {
      avatar: 'https://example.com/avatar.jpg',
    });

    console.log('更新成功:', updatedUser);
    return updatedUser;
  } catch (error) {
    console.error('更新失败:', error);
    throw error;
  }
}

/**
 * 示例5: 删除用户
 */
async function deleteUserExample(id: string) {
  try {
    await request.delete(`/api/examples/users/${id}`);
    console.log('删除成功');
  } catch (error) {
    console.error('删除失败:', error);
    throw error;
  }
}

/**
 * 示例6: 文件上传
 */
async function uploadFileExample(file: File) {
  try {
    const result = await request.upload<{ url: string }>(
      '/api/examples/upload',
      file,
    );

    console.log('上传成功,文件地址:', result.url);
    return result;
  } catch (error) {
    console.error('上传失败:', error);
    throw error;
  }
}

/**
 * 示例7: 错误处理
 */
async function errorHandlingExample() {
  try {
    const user = await request.get<User>('/api/examples/users/invalid-id');
  } catch (error) {
    // 错误会自动被拦截器处理:
    // - 401: 自动跳转登录页
    // - 其他: 自动显示错误消息
    
    if (error instanceof Error) {
      console.error('错误消息:', error.message);
    }
  }
}

/**
 * 示例8: 使用原始axios获取完整响应
 */
import axios from 'axios';

async function getFullResponseExample() {
  try {
    const response = await axios.get<ApiResponse<User>>(
      '/api/examples/users/123',
    );

    console.log('状态码:', response.data.code); // 200
    console.log('是否成功:', response.data.success); // true
    console.log('消息:', response.data.message); // "操作成功"
    console.log('数据:', response.data.data); // User对象

    return response.data.data;
  } catch (error) {
    console.error('请求失败:', error);
  }
}

/**
 * 示例9: React组件中使用
 */
import { useState, useEffect } from 'react';

function UserListComponent() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const loadUsers = async (pageNum: number, pageSize: number) => {
    setLoading(true);
    try {
      const pageData = await request.get<PageResponse<User>>(
        '/api/examples/users',
        { pageNum, pageSize },
      );

      setUsers(pageData.records);
      setPagination({
        current: pageData.current,
        pageSize: pageData.size,
        total: pageData.total,
      });
    } catch (error) {
      // 错误已被自动处理
      console.error('加载失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers(pagination.current, pagination.pageSize);
  }, []);

  return (
    <div>
      {loading ? (
        <div>加载中...</div>
      ) : (
        <div>
          <ul>
            {users.map((user) => (
              <li key={user.id}>
                {user.username} - {user.email}
              </li>
            ))}
          </ul>
          <div>
            共 {pagination.total} 条记录,当前第 {pagination.current} 页
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== 类型定义参考 ====================

/**
 * 来自 @ai-platform/shared
 */

// 通用响应
interface ApiResponse<T = any> {
  code: number;        // HTTP状态码
  data: T;             // 实际数据
  message: string;     // 提示信息
  success: boolean;    // 是否成功
}

// 分页响应
interface PageResponse<T = any> {
  records: T[];        // 数据列表
  total: number;       // 总记录数
  current: number;     // 当前页码
  size: number;        // 每页大小
  pages: number;       // 总页数
  orders?: any[];      // 排序信息
}

// 分页参数
interface PageParams {
  pageNum?: number;    // 页码(从1开始)
  pageSize?: number;   // 每页大小
  current?: number;    // 当前页(别名)
  size?: number;       // 每页大小(别名)
  [key: string]: any;  // 其他查询参数
}

export {
  getUserExample,
  getUserListExample,
  createUserExample,
  updateUserExample,
  deleteUserExample,
  uploadFileExample,
  errorHandlingExample,
  getFullResponseExample,
  UserListComponent,
};
