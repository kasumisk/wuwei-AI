#!/bin/bash

# Vercel 部署脚本
# 支持分别部署 Web (Next.js) 和 Admin (Vite) 到不同的 Vercel 项目

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Platform Vercel 部署脚本${NC}"
echo -e "${GREEN}======================================${NC}"

# 检查 Vercel CLI 是否安装
if ! command -v vercel &> /dev/null; then
    echo -e "${YELLOW}Vercel CLI 未安装，正在安装...${NC}"
    pnpm add -g vercel
fi

# 显示帮助信息
show_help() {
    echo ""
    echo "用法: ./scripts/deploy.sh [选项]"
    echo ""
    echo "选项:"
    echo "  web           部署 Next.js 主应用到 new-platform 项目"
    echo "  admin         部署 Vite 后台管理到 new-platform-admin 项目"
    echo "  all           部署所有前端应用"
    echo "  web:preview   预览部署 Web (不推送到生产)"
    echo "  admin:preview 预览部署 Admin (不推送到生产)"
    echo "  clean         清除所有 Vercel 部署配置目录"
    echo "  status        显示两个项目的状态"
    echo "  help          显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  ./scripts/deploy.sh web          # 部署 Next.js 应用到生产"
    echo "  ./scripts/deploy.sh admin        # 部署 Admin 应用到生产"
    echo "  ./scripts/deploy.sh all          # 部署所有应用"
    echo "  ./scripts/deploy.sh web:preview  # 预览部署 Web"
    echo "  ./scripts/deploy.sh clean        # 清除配置，重新开始"
    echo ""
    echo "项目配置:"
    echo "  Web:   .vercel-web/   -> kasumisks-projects/new-platform"
    echo "  Admin: .vercel-admin/ -> kasumisks-projects/new-platform-admin"
    echo ""
    echo "说明:"
    echo "  - 首次部署时，如果 .vercel-web 或 .vercel-admin 不存在，会自动创建新项目"
    echo "  - 使用 clean 命令可以清除所有配置，重新开始部署"
    echo ""
}

# 切换 Vercel 项目配置
switch_vercel_config() {
    local target=$1
    
    # 清理可能存在的 .vercel 目录
    if [ -d "$ROOT_DIR/.vercel" ]; then
        rm -rf "$ROOT_DIR/.vercel"
    fi
    
    # 复制对应的配置（如果存在）
    if [ "$target" = "web" ]; then
        if [ -d "$ROOT_DIR/.vercel-web" ]; then
            cp -r "$ROOT_DIR/.vercel-web" "$ROOT_DIR/.vercel"
            echo -e "${BLUE}已切换到 Web 项目配置${NC}"
            return 0
        else
            echo -e "${YELLOW}.vercel-web 目录不存在，将创建新项目${NC}"
            return 1
        fi
    elif [ "$target" = "admin" ]; then
        if [ -d "$ROOT_DIR/.vercel-admin" ]; then
            cp -r "$ROOT_DIR/.vercel-admin" "$ROOT_DIR/.vercel"
            echo -e "${BLUE}已切换到 Admin 项目配置${NC}"
            return 0
        else
            echo -e "${YELLOW}.vercel-admin 目录不存在，将创建新项目${NC}"
            return 1
        fi
    fi
}

# 清理临时 .vercel 目录
cleanup_vercel_config() {
    if [ -d "$ROOT_DIR/.vercel" ]; then
        rm -rf "$ROOT_DIR/.vercel"
    fi
}

# 保存 .vercel 配置到对应目录
save_vercel_config() {
    local target=$1
    
    if [ ! -d "$ROOT_DIR/.vercel" ]; then
        echo -e "${YELLOW}警告: .vercel 目录不存在，无法保存配置${NC}"
        return
    fi
    
    if [ "$target" = "web" ]; then
        rm -rf "$ROOT_DIR/.vercel-web"
        cp -r "$ROOT_DIR/.vercel" "$ROOT_DIR/.vercel-web"
        echo -e "${GREEN}已保存 Web 项目配置到 .vercel-web${NC}"
    elif [ "$target" = "admin" ]; then
        rm -rf "$ROOT_DIR/.vercel-admin"
        cp -r "$ROOT_DIR/.vercel" "$ROOT_DIR/.vercel-admin"
        echo -e "${GREEN}已保存 Admin 项目配置到 .vercel-admin${NC}"
    fi
}

# 清除所有 Vercel 配置
clean_all() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  清除 Vercel 部署配置${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    echo -e "${YELLOW}即将删除以下目录:${NC}"
    [ -d "$ROOT_DIR/.vercel" ] && echo "  - .vercel"
    [ -d "$ROOT_DIR/.vercel-web" ] && echo "  - .vercel-web"
    [ -d "$ROOT_DIR/.vercel-admin" ] && echo "  - .vercel-admin"
    
    echo ""
    read -p "确认删除这些配置? (y/N) " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$ROOT_DIR/.vercel"
        rm -rf "$ROOT_DIR/.vercel-web"
        rm -rf "$ROOT_DIR/.vercel-admin"
        echo -e "${GREEN}✓ 已清除所有 Vercel 配置${NC}"
        echo -e "${BLUE}下次部署时将创建新的项目${NC}"
    else
        echo -e "${YELLOW}已取消${NC}"
    fi
}

# 部署 Next.js 主应用
deploy_web() {
    local preview=$1
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  部署 Next.js 主应用 (Web)${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    local is_new_project=false
    switch_vercel_config "web" || is_new_project=true
    
    # 如果是新项目，确保清理所有临时配置，避免链接到错误的项目
    if [ "$is_new_project" = true ]; then
        echo -e "${YELLOW}检测到新项目部署，清理临时配置...${NC}"
        cleanup_vercel_config
        echo -e "${BLUE}提示: 部署时请选择创建新项目，建议项目名: new-platform-web${NC}"
    fi
    
    cd "$ROOT_DIR"
    
    if [ "$preview" = "preview" ]; then
        echo -e "${YELLOW}预览部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --yes
        else
            vercel --force
        fi
    else
        echo -e "${GREEN}生产部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            echo -e "${YELLOW}首次部署 Web，将创建新的 Vercel 项目...${NC}"
            vercel --prod --yes
        else
            vercel --prod --force
        fi
    fi
    
    # 如果是新项目，保存配置
    if [ "$is_new_project" = true ]; then
        save_vercel_config "web"
    fi
    
    cleanup_vercel_config
    echo -e "${GREEN}✓ Web 部署完成!${NC}"
}

# 部署 Vite Admin
deploy_admin() {
    local preview=$1
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  部署 Vite 后台管理 (Admin)${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    local is_new_project=false
    switch_vercel_config "admin" || is_new_project=true
    
    # 如果是新项目，确保清理所有临时配置，避免链接到错误的项目
    if [ "$is_new_project" = true ]; then
        echo -e "${YELLOW}检测到新项目部署，清理临时配置...${NC}"
        cleanup_vercel_config
        echo -e "${BLUE}提示: 部署时请选择创建新项目，建议项目名: new-platform-admin${NC}"
    fi
    
    cd "$ROOT_DIR"
    
    # 备份原 vercel.json 并使用 admin 配置
    if [ -f "$ROOT_DIR/vercel.json" ]; then
        cp "$ROOT_DIR/vercel.json" "$ROOT_DIR/vercel.json.bak"
    fi
    cp "$ROOT_DIR/vercel.admin.json" "$ROOT_DIR/vercel.json"
    
    if [ "$preview" = "preview" ]; then
        echo -e "${YELLOW}预览部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --yes
        else
            vercel --force
        fi
    else
        echo -e "${GREEN}生产部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            echo -e "${YELLOW}首次部署 Admin，将创建新的 Vercel 项目...${NC}"
            vercel --prod --yes
        else
            vercel --prod --force
        fi
    fi
    
    # 如果是新项目，保存配置
    if [ "$is_new_project" = true ]; then
        save_vercel_config "admin"
    fi
    
    # 恢复原 vercel.json
    if [ -f "$ROOT_DIR/vercel.json.bak" ]; then
        mv "$ROOT_DIR/vercel.json.bak" "$ROOT_DIR/vercel.json"
    fi
    
    cleanup_vercel_config
    echo -e "${GREEN}✓ Admin 部署完成!${NC}"
}

# 显示项目状态
show_status() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Vercel 项目状态${NC}"
    echo -e "${GREEN}========================================${NC}"
    
    echo ""
    echo -e "${BLUE}Web 项目 (.vercel-web):${NC}"
    if [ -f "$ROOT_DIR/.vercel-web/project.json" ]; then
        cat "$ROOT_DIR/.vercel-web/project.json"
        echo ""
    else
        echo -e "${RED}未配置${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}Admin 项目 (.vercel-admin):${NC}"
    if [ -f "$ROOT_DIR/.vercel-admin/project.json" ]; then
        cat "$ROOT_DIR/.vercel-admin/project.json"
        echo ""
    else
        echo -e "${RED}未配置${NC}"
    fi
    
    echo ""
    echo -e "${BLUE}Vercel 配置文件:${NC}"
    echo "  vercel.json (Web):       $([ -f "$ROOT_DIR/vercel.json" ] && echo '存在' || echo '不存在')"
    echo "  vercel.admin.json:       $([ -f "$ROOT_DIR/vercel.admin.json" ] && echo '存在' || echo '不存在')"
}

# 部署所有
deploy_all() {
    echo -e "${GREEN}正在部署所有应用...${NC}"
    echo ""
    deploy_web
    echo ""
    deploy_admin
}

# 主逻辑
case "$1" in
    web)
        deploy_web
        ;;
    admin)
        deploy_admin
        ;;
    all)
        deploy_all
        ;;
    web:preview)
        deploy_web "preview"
        ;;
    admin:preview)
        deploy_admin "preview"
        ;;
    clean)
        clean_all
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        if [ -z "$1" ]; then
            show_help
        else
            echo -e "${RED}未知选项: $1${NC}"
            show_help
            exit 1
        fi
        ;;
esac
