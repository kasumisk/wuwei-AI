/**
 * App 版本种子数据脚本
 * 运行方式：npx ts-node -r tsconfig-paths/register src/scripts/seed-app-versions.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  AppPlatform,
  UpdateType,
  AppVersionStatus,
  AppChannel,
} from '../../modules/app-version/app-version.types';

const prisma = new PrismaClient();

function parseVersionCode(version: string): number {
  const parts = version.split('.').map(Number);
  return (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

interface VersionSeedData {
  version: {
    platform?: AppPlatform;
    version: string;
    versionCode: number;
    updateType: UpdateType;
    title: string;
    description: string;
    minSupportVersion?: string;
    minSupportVersionCode?: number;
    status: AppVersionStatus;
    grayRelease: boolean;
    grayPercent: number;
    releaseDate?: Date;
    i18nDescription?: Record<string, string>;
  };
  packages: {
    platform: AppPlatform;
    channel: AppChannel;
    downloadUrl: string;
    fileSize: number;
    checksum?: string;
    enabled: boolean;
  }[];
}

const versionSeeds: VersionSeedData[] = [
  // ========== Android 版本 ==========
  {
    version: {
      platform: AppPlatform.ANDROID,
      version: '1.0.0',
      versionCode: parseVersionCode('1.0.0'),
      updateType: UpdateType.OPTIONAL,
      title: 'v1.0.0 首次发布',
      description:
        '## 🎉 首次发布\n\n- 基础功能上线\n- 支持文本生成\n- 支持多模型切换',
      status: AppVersionStatus.ARCHIVED,
      grayRelease: false,
      grayPercent: 0,
      releaseDate: new Date('2025-06-01'),
      i18nDescription: {
        'zh-CN':
          '## 🎉 首次发布\n\n- 基础功能上线\n- 支持文本生成\n- 支持多模型切换',
        'en-US':
          '## 🎉 Initial Release\n\n- Core features launched\n- Text generation support\n- Multi-model switching',
      },
    },
    packages: [
      {
        platform: AppPlatform.ANDROID,
        channel: AppChannel.OFFICIAL,
        downloadUrl: 'https://example.com/releases/android/app-v1.0.0.apk',
        fileSize: 15360000,
        checksum: 'md5:a1b2c3d4e5f6',
        enabled: true,
      },
    ],
  },
  {
    version: {
      platform: AppPlatform.ANDROID,
      version: '1.1.0',
      versionCode: parseVersionCode('1.1.0'),
      updateType: UpdateType.OPTIONAL,
      title: 'v1.1.0 功能优化',
      description:
        '## ✨ 功能优化\n\n- 新增图片识别功能\n- 优化对话界面\n- 修复已知 bug',
      status: AppVersionStatus.PUBLISHED,
      grayRelease: false,
      grayPercent: 0,
      releaseDate: new Date('2025-08-15'),
      i18nDescription: {
        'zh-CN':
          '## ✨ 功能优化\n\n- 新增图片识别功能\n- 优化对话界面\n- 修复已知 bug',
        'en-US':
          '## ✨ Feature Improvements\n\n- Added image recognition\n- Optimized chat UI\n- Fixed known bugs',
      },
    },
    packages: [
      {
        platform: AppPlatform.ANDROID,
        channel: AppChannel.OFFICIAL,
        downloadUrl: 'https://example.com/releases/android/app-v1.1.0.apk',
        fileSize: 16384000,
        checksum: 'md5:b2c3d4e5f6a7',
        enabled: true,
      },
    ],
  },
  {
    version: {
      platform: AppPlatform.ANDROID,
      version: '1.2.0',
      versionCode: parseVersionCode('1.2.0'),
      updateType: UpdateType.FORCE,
      title: 'v1.2.0 重要安全更新',
      description:
        '## 🔐 重要安全更新\n\n- 修复关键安全漏洞\n- 升级网络传输加密\n- 优化性能',
      minSupportVersion: '1.1.0',
      minSupportVersionCode: parseVersionCode('1.1.0'),
      status: AppVersionStatus.PUBLISHED,
      grayRelease: false,
      grayPercent: 0,
      releaseDate: new Date('2025-12-01'),
      i18nDescription: {
        'zh-CN':
          '## 🔐 重要安全更新\n\n- 修复关键安全漏洞\n- 升级网络传输加密\n- 优化性能',
        'en-US':
          '## 🔐 Critical Security Update\n\n- Fixed critical security vulnerability\n- Upgraded network encryption\n- Performance optimizations',
      },
    },
    packages: [
      {
        platform: AppPlatform.ANDROID,
        channel: AppChannel.OFFICIAL,
        downloadUrl: 'https://example.com/releases/android/app-v1.2.0.apk',
        fileSize: 17408000,
        checksum: 'md5:c3d4e5f6a7b8',
        enabled: true,
      },
    ],
  },

  // ========== iOS 版本 ==========
  {
    version: {
      platform: AppPlatform.IOS,
      version: '1.0.0',
      versionCode: parseVersionCode('1.0.0'),
      updateType: UpdateType.OPTIONAL,
      title: 'v1.0.0 首次发布',
      description:
        '## 🎉 首次发布\n\n- 基础功能上线\n- 支持文本生成\n- 支持多模型切换',
      status: AppVersionStatus.ARCHIVED,
      grayRelease: false,
      grayPercent: 0,
      releaseDate: new Date('2025-06-15'),
      i18nDescription: {
        'zh-CN':
          '## 🎉 首次发布\n\n- 基础功能上线\n- 支持文本生成\n- 支持多模型切换',
        'en-US':
          '## 🎉 Initial Release\n\n- Core features launched\n- Text generation support\n- Multi-model switching',
      },
    },
    packages: [
      {
        platform: AppPlatform.IOS,
        channel: AppChannel.APP_STORE,
        downloadUrl: 'https://apps.apple.com/app/example/id123456789',
        fileSize: 20480000,
        enabled: true,
      },
    ],
  },
  {
    version: {
      platform: AppPlatform.IOS,
      version: '1.1.0',
      versionCode: parseVersionCode('1.1.0'),
      updateType: UpdateType.OPTIONAL,
      title: 'v1.1.0 功能优化',
      description:
        '## ✨ 功能优化\n\n- 新增图片识别功能\n- 适配 iOS 17\n- 修复已知 bug',
      status: AppVersionStatus.PUBLISHED,
      grayRelease: false,
      grayPercent: 0,
      releaseDate: new Date('2025-09-01'),
      i18nDescription: {
        'zh-CN':
          '## ✨ 功能优化\n\n- 新增图片识别功能\n- 适配 iOS 17\n- 修复已知 bug',
        'en-US':
          '## ✨ Feature Improvements\n\n- Added image recognition\n- iOS 17 compatibility\n- Fixed known bugs',
      },
    },
    packages: [
      {
        platform: AppPlatform.IOS,
        channel: AppChannel.APP_STORE,
        downloadUrl: 'https://apps.apple.com/app/example/id123456789',
        fileSize: 22528000,
        enabled: true,
      },
    ],
  },

  // ========== 草稿版本 (用于测试) ==========
  {
    version: {
      platform: AppPlatform.ANDROID,
      version: '1.3.0',
      versionCode: parseVersionCode('1.3.0'),
      updateType: UpdateType.OPTIONAL,
      title: 'v1.3.0 新功能预览（灰度）',
      description:
        '## 🚀 新功能预览\n\n- AI 语音对话\n- 文档上传分析\n- 新增 DeepSeek 模型支持',
      minSupportVersion: '1.1.0',
      minSupportVersionCode: parseVersionCode('1.1.0'),
      status: AppVersionStatus.DRAFT,
      grayRelease: true,
      grayPercent: 20,
    },
    packages: [
      {
        platform: AppPlatform.ANDROID,
        channel: AppChannel.BETA,
        downloadUrl: 'https://example.com/releases/android/app-v1.3.0-beta.apk',
        fileSize: 18432000,
        checksum: 'sha256:d4e5f6a7b8c9',
        enabled: true,
      },
    ],
  },
];

async function seed() {
  console.log('🔄 开始初始化 App 版本数据...');

  for (const seed of versionSeeds) {
    const { version: versionData, packages: pkgDataList } = seed;

    let versionEntity = await prisma.appVersions.findFirst({
      where: {
        platform: versionData.platform,
        version: versionData.version,
      },
    });

    if (versionEntity) {
      console.log(
        `  ⏭️  版本已存在: ${versionData.platform} v${versionData.version}`,
      );
    } else {
      versionEntity = await prisma.appVersions.create({
        data: {
          platform: versionData.platform,
          version: versionData.version,
          versionCode: versionData.versionCode,
          updateType: versionData.updateType,
          title: versionData.title,
          description: versionData.description,
          minSupportVersion: versionData.minSupportVersion,
          minSupportVersionCode: versionData.minSupportVersionCode,
          status: versionData.status,
          grayRelease: versionData.grayRelease,
          grayPercent: versionData.grayPercent,
          releaseDate: versionData.releaseDate,
          i18nDescription: versionData.i18nDescription,
        },
      });
      console.log(
        `  ✅ 创建版本: ${versionData.platform} v${versionData.version} (${versionData.status})`,
      );
    }

    for (const pkgData of pkgDataList) {
      const existingPkg = await prisma.appVersionPackages.findFirst({
        where: {
          versionId: versionEntity.id,
          channel: pkgData.channel as string,
        },
      });
      if (!existingPkg) {
        await prisma.appVersionPackages.create({
          data: {
            versionId: versionEntity.id,
            platform: pkgData.platform,
            channel: pkgData.channel,
            downloadUrl: pkgData.downloadUrl,
            fileSize: pkgData.fileSize,
            checksum: pkgData.checksum,
            enabled: pkgData.enabled,
          },
        });
        console.log(`    📦 添加渠道包: ${pkgData.channel}`);
      }
    }
  }

  console.log('\n✅ App 版本数据初始化完成！');
  console.log('\n📊 总结:');
  console.log('  - Android 版本: 4 个 (3 发布/归档, 1 草稿灰度)');
  console.log('  - iOS 版本: 2 个 (全部发布/归档)');

  await prisma.$disconnect();
}

seed().catch(async (err) => {
  console.error('❌ 初始化失败:', err);
  await prisma.$disconnect();
  process.exit(1);
});
