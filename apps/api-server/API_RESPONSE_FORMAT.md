# API 响应格式规范

## 概述

本项目使用统一的API响应格式,所有接口返回的数据结构保持一致,便于前端统一处理。

## 响应格式

### 成功响应

```typescript
{
  "code": 200,           // HTTP状态码
  "data": any,           // 实际返回的数据
  "message": "操作成功", // 提示信息
  "success": true        // 操作是否成功
}
```

### 错误响应

```typescript
{
  "code": 400 | 401 | 403 | 404 | 500, // HTTP状态码
  "data": null,                         // 错误时通常为null
  "message": "错误信息",                // 错误描述
  "success": false                      // 操作失败
}
```

### 分页响应

```typescript
{
  "code": 200,
  "data": {
    "records": [...],      // 数据列表
    "total": 100,          // 总记录数
    "current": 1,          // 当前页码
    "size": 10,            // 每页大小
    "pages": 10,           // 总页数
    "orders": []           // 排序信息
  },
  "message": "操作成功",
  "success": true
}
```

## 类型定义

### 共享类型包 `@ai-platform/shared`

```typescript
/**
 * 通用 API 响应接口
 */
export interface ApiResponse<T = any> {
  code: number;
  data: T;
  message: string;
  success: boolean;
}

/**
 * 分页响应数据
 */
export interface PageResponse<T = any> {
  records: T[];
  total: number;
  current: number;
  size: number;
  pages: number;
  orders?: any[];
}

/**
 * 分页请求参数
 */
export interface PageParams {
  pageNum?: number;
  pageSize?: number;
  current?: number;
  size?: number;
  [key: string]: any;
}
```

## 后端实现

### 响应拦截器

位置: `apps/server/src/core/interceptors/response.interceptor.ts`

所有成功的响应会自动被包装成统一格式:

```typescript
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // 如果已经是标准格式,直接返回
        if (
          data &&
          typeof data === 'object' &&
          'code' in data &&
          'success' in data
        ) {
          return data as ApiResponse<T>;
        }

        // 否则包装为标准格式
        return {
          code: 200,
          data: data as T,
          message: '操作成功',
          success: true,
        };
      }),
    );
  }
}
```

### 异常过滤器

位置: `apps/server/src/core/filters/all-exceptions.filter.ts`

所有异常会自动转换成统一的错误响应:

```typescript
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    // ... 错误处理逻辑

    response.status(status).json({
      code: status,
      data: details || null,
      message,
      success: false,
    });
  }
}
```

## 前端使用

### Axios 配置

位置: `apps/admin/src/utils/request.ts`

响应拦截器自动解包data字段:

```typescript
instance.interceptors.response.use(
  (response) => {
    const { data } = response as { data: ApiResponse };

    // 处理业务成功
    if (data.success === true || data.code === 200 || data.code === 0) {
      return data.data; // 直接返回data字段
    }

    // 处理401未授权
    if (data.code === 401) {
      globalMessage.error(data.message || '登录已过期，请重新登录');
      clearUserInfo();
      window.location.href = '/login';
      return Promise.reject(data.message);
    }

    // 处理其他业务错误
    const errorMessage = data.message || '请求失败';
    globalMessage.error(errorMessage);
    return Promise.reject(new Error(errorMessage));
  },
  // ... 错误处理
);
```

### 使用示例

```typescript
import request from '@/utils/request';
import type { ApiResponse, PageResponse } from '@ai-platform/shared';

// 示例1: 普通请求
const user = await request.get<User>('/api/users/1');
// user 类型为 User, 已自动解包

// 示例2: 分页请求
const pageData = await request.get<PageResponse<User>>('/api/users', {
  pageNum: 1,
  pageSize: 10,
});
// pageData.records 为 User[]
// pageData.total 为总数

// 示例3: 手动处理完整响应
const response = await axios.get<ApiResponse<User>>('/api/users/1');
console.log(response.data.code); // 200
console.log(response.data.success); // true
console.log(response.data.message); // "操作成功"
console.log(response.data.data); // User对象
```

## 状态码说明

### HTTP 状态码 (来自 `@ai-platform/constants`)

```typescript
export const HTTP_STATUS = {
  OK: 200, // 请求成功
  CREATED: 201, // 创建成功
  NO_CONTENT: 204, // 无内容
  BAD_REQUEST: 400, // 请求参数错误
  UNAUTHORIZED: 401, // 未授权/登录过期
  FORBIDDEN: 403, // 无权限
  NOT_FOUND: 404, // 资源不存在
  CONFLICT: 409, // 冲突(如重复创建)
  UNPROCESSABLE_ENTITY: 422, // 数据验证失败
  INTERNAL_SERVER_ERROR: 500, // 服务器内部错误
  BAD_GATEWAY: 502, // 网关错误
  SERVICE_UNAVAILABLE: 503, // 服务不可用
} as const;
```

### 业务状态码

```typescript
export const BUSINESS_CODE = {
  SUCCESS: 0, // 成功
  ERROR: -1, // 通用错误
  UNAUTHORIZED: 401, // 未授权
  FORBIDDEN: 403, // 禁止访问
  NOT_FOUND: 404, // 未找到
  VALIDATION_ERROR: 422, // 验证错误
  INTERNAL_ERROR: 500, // 内部错误
} as const;
```

## 最佳实践

### 1. Controller 层

```typescript
@Controller('users')
export class UserController {
  // ✅ 推荐: 直接返回数据,由拦截器自动包装
  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  // ✅ 也可以: 手动返回标准格式
  @Get(':id')
  async getUser(@Param('id') id: string): Promise<ApiResponse<User>> {
    const user = await this.userService.findById(id);
    return {
      code: 200,
      data: user,
      message: '获取成功',
      success: true,
    };
  }
}
```

### 2. Service 层

```typescript
@Injectable()
export class UserService {
  // ✅ Service只返回数据,不包装响应格式
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }
}
```

### 3. 前端调用

```typescript
// ✅ 使用封装的request方法
import request from '@/utils/request';

// 自动解包,直接获得数据
const user = await request.get<User>('/api/users/1');
console.log(user.username);

// ✅ 分页数据
const pageData = await request.get<PageResponse<User>>('/api/users', {
  pageNum: 1,
  pageSize: 10,
});
console.log(pageData.records);
console.log(pageData.total);
```

## 迁移指南

### 从旧格式迁移

如果你的代码使用了旧的响应格式:

```typescript
// 旧格式
{
  requestId: "req_123",
  code: 200,
  message: "Success",
  data: {...},
  timestamp: 1234567890
}
```

迁移步骤:

1. **后端**: 响应拦截器已自动适配新格式
2. **前端**: 更新类型导入

   ```typescript
   // 旧的
   import { ApiResponse } from '@/utils/request';

   // 新的
   import type { ApiResponse } from '@ai-platform/shared';
   ```

3. **检查字段使用**:
   - `data.success` 替代 `data.code === 200`
   - 移除 `requestId` 和 `timestamp` 的使用

## 注意事项

1. **类型安全**: 始终使用 TypeScript 类型,确保类型一致性
2. **错误处理**: 前端必须处理 `success === false` 的情况
3. **分页参数**: 统一使用 `PageParams` 类型
4. **状态码**: 使用常量而非硬编码数字

## 相关文件

- 类型定义: `packages/shared/src/types/api.ts`
- 常量定义: `packages/constants/src/api.ts`
- 响应拦截器: `apps/server/src/core/interceptors/response.interceptor.ts`
- 异常过滤器: `apps/server/src/core/filters/all-exceptions.filter.ts`
- 前端封装: `apps/admin/src/utils/request.ts`
- 响应工具: `apps/server/src/common/types/response.type.ts`
