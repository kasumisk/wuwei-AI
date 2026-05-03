#!/bin/bash

# Vercel 部署脚本
# 支持分别部署 Web (Next.js) 和 Admin (Vite) 到不同的 Vercel 项目
# 支持 staging / prod 两套环境

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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
    echo "用法: ./scripts/deploy.sh [目标] [环境]"
    echo ""
    echo "目标:"
    echo "  web           部署 Next.js 主应用"
    echo "  admin         部署 Vite 后台管理"
    echo "  all           部署所有前端应用"
    echo "  web:preview   预览部署 Web (不推送到生产)"
    echo "  admin:preview 预览部署 Admin (不推送到生产)"
    echo "  clean         清除所有 Vercel 部署配置目录"
    echo "  status        显示两个项目的状态"
    echo "  help          显示此帮助信息"
    echo ""
    echo "环境 (第二个参数，默认为 prod):"
    echo "  staging       部署到 Staging 环境 (Preview 部署 + staging 环境变量)"
    echo "  prod          部署到 Production 环境 (默认)"
    echo ""
    echo "示例:"
    echo "  ./scripts/deploy.sh web               # 部署 Web 到 prod"
    echo "  ./scripts/deploy.sh web prod          # 同上"
    echo "  ./scripts/deploy.sh web staging       # 部署 Web 到 staging"
    echo "  ./scripts/deploy.sh admin staging     # 部署 Admin 到 staging"
    echo "  ./scripts/deploy.sh all staging       # 部署所有应用到 staging"
    echo "  ./scripts/deploy.sh all               # 部署所有应用到 prod"
    echo "  ./scripts/deploy.sh web:preview       # 临时预览部署 Web"
    echo "  ./scripts/deploy.sh clean             # 清除配置，重新开始"
    echo ""
    echo "项目配置目录:"
    echo "  Web   prod:    .vercel-web/"
    echo "  Web   staging: .vercel-web-staging/"
    echo "  Admin prod:    .vercel-admin/"
    echo "  Admin staging: .vercel-admin-staging/"
    echo ""
    echo "说明:"
    echo "  - staging 环境使用 Vercel Preview 部署（不覆盖生产）"
    echo "  - staging 环境变量从 apps/*/。env.staging 注入"
    echo "  - 首次部署时若配置目录不存在，会创建新的 Vercel 项目"
    echo ""
}

# ──────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────

# 获取对应环境的 .vercel 持久化目录名
vercel_dir_name() {
    local target=$1   # web | admin
    local env=$2      # prod | staging
    if [ "$env" = "staging" ]; then
        echo ".vercel-${target}-staging"
    else
        echo ".vercel-${target}"
    fi
}

# 切换 Vercel 项目配置
switch_vercel_config() {
    local target=$1
    local env=$2
    local dir_name
    dir_name=$(vercel_dir_name "$target" "$env")

    # 清理可能存在的临时 .vercel 目录
    if [ -d "$ROOT_DIR/.vercel" ]; then
        rm -rf "$ROOT_DIR/.vercel"
    fi

    if [ -d "$ROOT_DIR/$dir_name" ]; then
        cp -r "$ROOT_DIR/$dir_name" "$ROOT_DIR/.vercel"
        echo -e "${BLUE}已切换到 ${target}/${env} 项目配置 (${dir_name})${NC}"
        return 0
    else
        echo -e "${YELLOW}${dir_name} 目录不存在，将创建新项目${NC}"
        return 1
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
    local env=$2
    local dir_name
    dir_name=$(vercel_dir_name "$target" "$env")

    if [ ! -d "$ROOT_DIR/.vercel" ]; then
        echo -e "${YELLOW}警告: .vercel 目录不存在，无法保存配置${NC}"
        return
    fi

    rm -rf "$ROOT_DIR/$dir_name"
    cp -r "$ROOT_DIR/.vercel" "$ROOT_DIR/$dir_name"
    echo -e "${GREEN}已保存 ${target}/${env} 项目配置到 ${dir_name}${NC}"
}

# 清除所有 Vercel 配置
clean_all() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  清除 Vercel 部署配置${NC}"
    echo -e "${GREEN}========================================${NC}"

    local dirs=(".vercel" ".vercel-web" ".vercel-web-staging" ".vercel-admin" ".vercel-admin-staging")
    echo -e "${YELLOW}即将删除以下目录（如存在）:${NC}"
    for d in "${dirs[@]}"; do
        [ -d "$ROOT_DIR/$d" ] && echo "  - $d"
    done

    echo ""
    read -p "确认删除这些配置? (y/N) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        for d in "${dirs[@]}"; do
            rm -rf "$ROOT_DIR/$d"
        done
        echo -e "${GREEN}✓ 已清除所有 Vercel 配置${NC}"
        echo -e "${BLUE}下次部署时将创建新的项目${NC}"
    else
        echo -e "${YELLOW}已取消${NC}"
    fi
}

# ──────────────────────────────────────────
# 环境变量注入
# ──────────────────────────────────────────

# 将指定 .env 文件的变量通过 vercel env add 写入（仅新项目首次使用）
# 对于已存在项目，Vercel Dashboard 管理变量更可靠；
# 这里主要用于在构建时把 env 文件复制到对应 app 目录供构建使用。

# 备份并切换 app 目录下的 .env.local / .env（用于 Next.js）或
# 直接依赖 Vite --mode 参数（admin 使用 vite build --mode staging）

prepare_web_env() {
    local env=$1  # staging | prod
    local web_dir="$ROOT_DIR/apps/web"

    # Next.js 在构建时会读取 .env.production（--prod 构建）
    # 我们通过将对应环境文件复制为 .env.production 来注入变量
    if [ "$env" = "staging" ]; then
        if [ -f "$web_dir/.env.staging" ]; then
            [ -f "$web_dir/.env.production" ] && cp "$web_dir/.env.production" "$web_dir/.env.production.bak"
            cp "$web_dir/.env.staging" "$web_dir/.env.production"
            echo -e "${CYAN}[web] 已将 .env.staging 注入为 .env.production${NC}"
        else
            echo -e "${YELLOW}[web] 未找到 .env.staging，将使用默认 .env.production${NC}"
        fi
    fi
    # prod 直接使用已有 .env.production，无需处理
}

restore_web_env() {
    local env=$1
    local web_dir="$ROOT_DIR/apps/web"

    if [ "$env" = "staging" ]; then
        if [ -f "$web_dir/.env.production.bak" ]; then
            mv "$web_dir/.env.production.bak" "$web_dir/.env.production"
            echo -e "${CYAN}[web] 已恢复 .env.production${NC}"
        fi
    fi
}

# ──────────────────────────────────────────
# 部署函数
# ──────────────────────────────────────────

# 部署 Next.js 主应用
deploy_web() {
    local mode=$1   # "" | "preview"
    local env=$2    # "prod" | "staging"
    env="${env:-prod}"

    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  部署 Next.js 主应用 (Web) [${env}]${NC}"
    echo -e "${GREEN}========================================${NC}"

    local is_new_project=false
    switch_vercel_config "web" "$env" || is_new_project=true

    if [ "$is_new_project" = true ]; then
        echo -e "${YELLOW}检测到新项目部署，清理临时配置...${NC}"
        cleanup_vercel_config
        if [ "$env" = "staging" ]; then
            echo -e "${BLUE}提示: 部署时请选择创建新项目，建议项目名: new-platform-web-staging${NC}"
        else
            echo -e "${BLUE}提示: 部署时请选择创建新项目，建议项目名: new-platform-web${NC}"
        fi
    fi

    cd "$ROOT_DIR"

    # 备份并切换 vercel.json
    [ -f "$ROOT_DIR/vercel.json" ] && cp "$ROOT_DIR/vercel.json" "$ROOT_DIR/vercel.json.bak"
    cp "$ROOT_DIR/vercel.web.json" "$ROOT_DIR/vercel.json"

    # 切换 .vercelignore
    [ -f "$ROOT_DIR/.vercelignore" ] && cp "$ROOT_DIR/.vercelignore" "$ROOT_DIR/.vercelignore.bak"
    cp "$ROOT_DIR/.vercelignore-web" "$ROOT_DIR/.vercelignore"

    # 注入环境变量
    prepare_web_env "$env"

    if [ "$env" = "staging" ]; then
        # staging: 使用 Preview 部署（不带 --prod）
        echo -e "${CYAN}Staging 部署模式（Preview）...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --name eatcheck-web-staging --yes
        else
            vercel --force
        fi
    elif [ "$mode" = "preview" ]; then
        echo -e "${YELLOW}预览部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --name eatcheck-web --yes
        else
            vercel --force
        fi
    else
        echo -e "${GREEN}生产部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --name eatcheck-web --prod --yes
        else
            vercel --prod --force
        fi
    fi

    # 保存新项目配置
    [ "$is_new_project" = true ] && save_vercel_config "web" "$env"

    # 恢复 vercel.json
    if [ -f "$ROOT_DIR/vercel.json.bak" ]; then
        mv "$ROOT_DIR/vercel.json.bak" "$ROOT_DIR/vercel.json"
    fi

    # 恢复 .vercelignore
    if [ -f "$ROOT_DIR/.vercelignore.bak" ]; then
        mv "$ROOT_DIR/.vercelignore.bak" "$ROOT_DIR/.vercelignore"
    else
        rm -f "$ROOT_DIR/.vercelignore"
    fi

    # 恢复环境变量文件
    restore_web_env "$env"

    cleanup_vercel_config
    echo -e "${GREEN}✓ Web [${env}] 部署完成!${NC}"
}

# 部署 Vite Admin
deploy_admin() {
    local mode=$1   # "" | "preview"
    local env=$2    # "prod" | "staging"
    env="${env:-prod}"

    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  部署 Vite 后台管理 (Admin) [${env}]${NC}"
    echo -e "${GREEN}========================================${NC}"

    local is_new_project=false
    switch_vercel_config "admin" "$env" || is_new_project=true

    if [ "$is_new_project" = true ]; then
        echo -e "${YELLOW}检测到新项目部署，清理临时配置...${NC}"
        cleanup_vercel_config
        if [ "$env" = "staging" ]; then
            echo -e "${BLUE}提示: 部署时请选择创建新项目，建议项目名: new-platform-admin-staging${NC}"
        else
            echo -e "${BLUE}提示: 部署时请选择创建新项目，建议项目名: new-platform-admin${NC}"
        fi
    fi

    cd "$ROOT_DIR"

    # 备份并切换 vercel.json
    [ -f "$ROOT_DIR/vercel.json" ] && cp "$ROOT_DIR/vercel.json" "$ROOT_DIR/vercel.json.bak"

    # staging 使用独立的 vercel.admin.staging.json（如存在），否则复用 admin json 但调整构建命令
    if [ "$env" = "staging" ] && [ -f "$ROOT_DIR/vercel.admin.staging.json" ]; then
        cp "$ROOT_DIR/vercel.admin.staging.json" "$ROOT_DIR/vercel.json"
    else
        cp "$ROOT_DIR/vercel.admin.json" "$ROOT_DIR/vercel.json"
        if [ "$env" = "staging" ]; then
            # 使用 admin 的 build:staging npm 脚本（vite build --mode=staging）
            node -e "
                const fs = require('fs');
                const cfg = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
                cfg.buildCommand = 'pnpm --filter=@ai-platform/admin build:staging';
                fs.writeFileSync('vercel.json', JSON.stringify(cfg, null, 2));
            "
            echo -e "${CYAN}[admin] 已将 buildCommand 切换为 build:staging${NC}"
        fi
    fi

    # 切换 .vercelignore
    [ -f "$ROOT_DIR/.vercelignore" ] && cp "$ROOT_DIR/.vercelignore" "$ROOT_DIR/.vercelignore.bak"
    cp "$ROOT_DIR/.vercelignore-admin" "$ROOT_DIR/.vercelignore"

    if [ "$env" = "staging" ]; then
        echo -e "${CYAN}Staging 部署模式（Preview）...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --name eatcheck-admin-staging --yes
        else
            vercel --force
        fi
    elif [ "$mode" = "preview" ]; then
        echo -e "${YELLOW}预览部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --name eatcheck-admin --yes
        else
            vercel --force
        fi
    else
        echo -e "${GREEN}生产部署模式...${NC}"
        if [ "$is_new_project" = true ]; then
            vercel --name eatcheck-admin --prod --yes
        else
            vercel --prod --force
        fi
    fi

    # 保存新项目配置
    [ "$is_new_project" = true ] && save_vercel_config "admin" "$env"

    # 恢复 vercel.json
    if [ -f "$ROOT_DIR/vercel.json.bak" ]; then
        mv "$ROOT_DIR/vercel.json.bak" "$ROOT_DIR/vercel.json"
    fi

    # 恢复 .vercelignore
    if [ -f "$ROOT_DIR/.vercelignore.bak" ]; then
        mv "$ROOT_DIR/.vercelignore.bak" "$ROOT_DIR/.vercelignore"
    else
        rm -f "$ROOT_DIR/.vercelignore"
    fi

    cleanup_vercel_config
    echo -e "${GREEN}✓ Admin [${env}] 部署完成!${NC}"
}

# 显示项目状态
show_status() {
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Vercel 项目状态${NC}"
    echo -e "${GREEN}========================================${NC}"

    local targets=("web" "admin")
    local envs=("prod" "staging")

    for target in "${targets[@]}"; do
        for env in "${envs[@]}"; do
            local dir_name
            dir_name=$(vercel_dir_name "$target" "$env")
            echo ""
            echo -e "${BLUE}${target} / ${env}  (${dir_name}):${NC}"
            if [ -f "$ROOT_DIR/$dir_name/project.json" ]; then
                cat "$ROOT_DIR/$dir_name/project.json"
                echo ""
            else
                echo -e "${RED}  未配置${NC}"
            fi
        done
    done

    echo ""
    echo -e "${BLUE}Vercel 配置文件:${NC}"
    echo "  vercel.web.json:         $([ -f "$ROOT_DIR/vercel.web.json" ] && echo '存在' || echo '不存在')"
    echo "  vercel.admin.json:       $([ -f "$ROOT_DIR/vercel.admin.json" ] && echo '存在' || echo '不存在')"
    echo "  vercel.admin.staging.json: $([ -f "$ROOT_DIR/vercel.admin.staging.json" ] && echo '存在' || echo '不存在（将复用 admin.json + staging 模式）')"
}

# 部署所有
deploy_all() {
    local env="${1:-prod}"
    echo -e "${GREEN}正在部署所有应用 [${env}]...${NC}"
    echo ""
    deploy_web "" "$env"
    echo ""
    deploy_admin "" "$env"
}

# ──────────────────────────────────────────
# 主逻辑
# ──────────────────────────────────────────
# 参数解析说明:
#   $1 = 目标 (web / admin / all / web:preview / admin:preview / ...)
#   $2 = 环境 (staging / prod，默认 prod)
#
# 旧用法 "web:preview" 仍然保留兼容，同时支持 "web staging" 新用法

TARGET="$1"
ENV="${2:-prod}"

# 规范化环境参数
if [ "$ENV" != "staging" ] && [ "$ENV" != "prod" ]; then
    echo -e "${RED}未知环境: $ENV（支持 staging / prod）${NC}"
    show_help
    exit 1
fi

case "$TARGET" in
    web)
        deploy_web "" "$ENV"
        ;;
    admin)
        deploy_admin "" "$ENV"
        ;;
    all)
        deploy_all "$ENV"
        ;;
    web:preview)
        deploy_web "preview" "prod"
        ;;
    admin:preview)
        deploy_admin "preview" "prod"
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
        if [ -z "$TARGET" ]; then
            show_help
        else
            echo -e "${RED}未知选项: $TARGET${NC}"
            show_help
            exit 1
        fi
        ;;
esac
