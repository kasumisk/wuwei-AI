#!/bin/bash

# AI Platform - PostgreSQL 数据库初始化脚本

echo "🔧 初始化 PostgreSQL 数据库..."

# 获取当前系统用户名
CURRENT_USER=$(whoami)

echo "当前系统用户: $CURRENT_USER"
echo ""

# 尝试创建 postgres 角色（如果不存在）
echo "创建 postgres 用户（如果需要）..."
psql -d postgres -c "CREATE ROLE postgres WITH SUPERUSER CREATEDB CREATEROLE LOGIN PASSWORD 'postgres';" 2>/dev/null || echo "postgres 用户可能已存在"

# 或者使用当前用户创建数据库
echo ""
echo "使用当前用户 ($CURRENT_USER) 创建数据库..."
createdb ai_platform 2>/dev/null && echo "✅ 数据库 ai_platform 创建成功" || echo "⚠️  数据库可能已存在"

echo ""
echo "📋 数据库配置建议："
echo ""
echo "选项 1: 使用 postgres 用户（推荐）"
echo "  DB_USERNAME=postgres"
echo "  DB_PASSWORD=postgres"
echo ""
echo "选项 2: 使用当前系统用户"
echo "  DB_USERNAME=$CURRENT_USER"
echo "  DB_PASSWORD=  # 留空"
echo ""

# 测试连接
echo "🔍 测试数据库连接..."
echo ""

if psql -U postgres -d ai_platform -c "SELECT version();" 2>/dev/null; then
    echo "✅ 使用 postgres 用户连接成功！"
    echo ""
    echo "请在 .env 文件中配置:"
    echo "DB_USERNAME=postgres"
    echo "DB_PASSWORD=postgres"
elif psql -d ai_platform -c "SELECT version();" 2>/dev/null; then
    echo "✅ 使用当前用户连接成功！"
    echo ""
    echo "请在 .env 文件中配置:"
    echo "DB_USERNAME=$CURRENT_USER"
    echo "DB_PASSWORD=  # 留空或不设置"
else
    echo "❌ 数据库连接测试失败"
    echo ""
    echo "请手动执行以下命令:"
    echo "  createuser -s postgres"
    echo "  createdb ai_platform"
fi

echo ""
echo "完成！"
