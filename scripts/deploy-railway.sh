#!/bin/bash

# =============================================================================
# Railway 一键部署脚本 - API Server (NestJS + PostgreSQL)
# =============================================================================
# 使用方式:
#   ./scripts/deploy-railway.sh [命令]
#
# 命令列表:
#   init       首次完整部署（创建项目 + 数据库 + 部署 + 初始化种子数据）
#   deploy     部署代码更新
#   logs       查看运行日志
#   logs:build 查看构建日志
#   db:init    初始化数据库（种子数据）
#   db:seed    运行种子数据脚本
#   db:connect 连接数据库 Shell
#   db:backup  备份数据库
#   db:restore 从文件恢复数据库
#   health     健康检查
#   status     查看服务状态
#   env        查看环境变量
#   env:set    批量设置环境变量
#   restart    重启服务（不重建）
#   redeploy   重新部署（重新构建）
#   rollback   回滚到上一次部署
#   domain     生成/查看域名
#   open       打开 Railway 控制台
#   destroy    销毁项目（危险操作）
#   help       显示帮助信息
# =============================================================================

set -e

# ─── 颜色定义 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── 项目路径 ─────────────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api-server"
BACKUP_DIR="$ROOT_DIR/backups"

# ─── Railway 服务名 ──────────────────────────────────────────────────────────
SERVICE_NAME="api-server"

# ─── 辅助函数 ─────────────────────────────────────────────────────────────────

print_header() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║${NC}  ${BOLD}$1${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${CYAN}▶${NC} ${BOLD}$1${NC}"
}

print_success() {
    echo -e "${GREEN}✔${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✖${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# 检查 Railway CLI 是否安装并已登录
check_railway_cli() {
    if ! command -v railway &> /dev/null; then
        print_error "Railway CLI 未安装"
        echo ""
        echo "  安装方式:"
        echo "    macOS:  brew install railway"
        echo "    npm:    npm install -g @railway/cli"
        echo ""
        exit 1
    fi

    # 检查登录状态
    if ! railway whoami &> /dev/null 2>&1; then
        print_warn "Railway CLI 未登录，正在登录..."
        railway login
    fi
}

# 检查是否已链接到项目
check_project_linked() {
    if ! railway status &> /dev/null 2>&1; then
        print_error "当前目录未链接到 Railway 项目"
        echo ""
        echo "  请先运行: ./scripts/deploy-railway.sh init"
        echo "  或手动链接: railway link"
        echo ""
        exit 1
    fi
}

# 获取 Postgres 服务的公网连接信息
get_db_public_url() {
    local db_url
    # 尝试获取 DATABASE_PUBLIC_URL 变量
    db_url=$(railway variables 2>/dev/null | grep "DATABASE_PUBLIC_URL" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    echo "$db_url"
}

# 从 DATABASE_PUBLIC_URL 解析连接参数
parse_db_url() {
    local url="$1"
    if [ -z "$url" ]; then
        return 1
    fi
    # postgresql://user:pass@host:port/db
    DB_PUB_USER=$(echo "$url" | sed -n 's|.*://\([^:]*\):.*|\1|p')
    DB_PUB_PASS=$(echo "$url" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')
    DB_PUB_HOST=$(echo "$url" | sed -n 's|.*@\([^:]*\):.*|\1|p')
    DB_PUB_PORT=$(echo "$url" | sed -n 's|.*:\([0-9]*\)/.*|\1|p' | tail -1)
    DB_PUB_NAME=$(echo "$url" | sed -n 's|.*/\([^?]*\).*|\1|p')
}

# 切换到指定服务
switch_to_service() {
    local svc_name="$1"
    print_info "切换到服务: $svc_name"
    railway service link "$svc_name" 2>/dev/null || railway service "$svc_name" 2>/dev/null || true
}

# ─── 命令实现 ─────────────────────────────────────────────────────────────────

# 首次完整初始化部署
cmd_init() {
    print_header "Railway 首次完整部署"

    check_railway_cli
    cd "$ROOT_DIR"

    # 步骤 1: 初始化项目
    print_step "第 1 步: 初始化 Railway 项目"
    if railway status &> /dev/null 2>&1; then
        print_warn "已链接到 Railway 项目，跳过初始化"
        railway status
    else
        railway init
        print_success "项目创建成功"
    fi
    echo ""

    # 步骤 2: 添加 PostgreSQL
    print_step "第 2 步: 添加 PostgreSQL 数据库"
    echo -e "${DIM}   (如果已存在会自动跳过)${NC}"
    railway add --database postgres 2>/dev/null || print_warn "PostgreSQL 可能已存在"
    print_success "PostgreSQL 已就绪"
    echo ""

    # 步骤 3: 创建 API 服务
    print_step "第 3 步: 创建 API 服务"
    echo -e "${DIM}   (如果已存在会自动跳过)${NC}"
    railway add --service "$SERVICE_NAME" 2>/dev/null || print_warn "服务 $SERVICE_NAME 可能已存在"

    # 链接到 api-server 服务
    switch_to_service "$SERVICE_NAME"
    print_success "API 服务已就绪"
    echo ""

    # 步骤 4: 获取数据库密码并配置环境变量
    print_step "第 4 步: 配置环境变量"

    # 先切换到 Postgres 获取连接信息
    switch_to_service "Postgres"
    local pg_password
    pg_password=$(railway variables 2>/dev/null | grep "PGPASSWORD" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    local pg_pub_host
    pg_pub_host=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_DOMAIN" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    local pg_pub_port
    pg_pub_port=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_PORT" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)

    if [ -z "$pg_password" ]; then
        print_error "无法获取 PostgreSQL 密码，请手动配置环境变量"
        echo "  railway service link Postgres"
        echo "  railway variables"
        exit 1
    fi

    print_info "数据库密码已获取"
    print_info "公网地址: $pg_pub_host:$pg_pub_port"

    # 切回 api-server 服务
    switch_to_service "$SERVICE_NAME"

    # 设置环境变量
    railway variables \
        --set "NODE_ENV=production" \
        --set "PORT=3000" \
        --set "DB_HOST=postgres.railway.internal" \
        --set "DB_PORT=5432" \
        --set "DB_USERNAME=postgres" \
        --set "DB_PASSWORD=$pg_password" \
        --set "DB_DATABASE=railway" \
        --set "DB_SYNCHRONIZE=true" \
        --set "LOG_LEVEL=info" \
        --set "API_PREFIX=api" \
        --set "API_VERSION=v1"

    print_success "环境变量已配置"
    echo ""

    # 步骤 5: 部署
    print_step "第 5 步: 上传代码并构建部署"
    railway up --detach
    print_success "代码已上传，构建中..."
    echo ""

    # 步骤 6: 等待部署完成
    print_step "第 6 步: 等待部署完成"
    echo -e "${DIM}   等待构建和部署（约 2-5 分钟）...${NC}"

    local max_wait=300  # 最多等待 5 分钟
    local elapsed=0
    local interval=15

    while [ $elapsed -lt $max_wait ]; do
        sleep $interval
        elapsed=$((elapsed + interval))

        # 尝试健康检查
        local domain
        domain=$(railway domain 2>/dev/null | grep "https://" | tr -d ' ' || true)

        if [ -n "$domain" ]; then
            local health_url="${domain}/api/health/live"
            local response
            response=$(curl -s --max-time 10 "$health_url" 2>/dev/null || true)

            if echo "$response" | grep -q '"alive":true' 2>/dev/null; then
                echo ""
                print_success "服务已上线! (${elapsed}s)"
                break
            fi
        fi

        printf "\r  ⏳ 已等待 ${elapsed}s / ${max_wait}s ..."
    done

    if [ $elapsed -ge $max_wait ]; then
        echo ""
        print_warn "等待超时，但部署可能仍在进行中"
        print_info "请稍后使用 './scripts/deploy-railway.sh health' 检查状态"
    fi
    echo ""

    # 步骤 7: 生成域名
    print_step "第 7 步: 获取服务域名"
    local domain_output
    domain_output=$(railway domain 2>/dev/null || true)
    echo "  $domain_output"
    local api_url
    api_url=$(echo "$domain_output" | grep -o 'https://[^ ]*' | head -1 || true)
    echo ""

    # 步骤 8: 初始化数据库
    print_step "第 8 步: 初始化数据库（种子数据）"
    if [ -n "$pg_pub_host" ] && [ -n "$pg_pub_port" ] && [ -n "$pg_password" ]; then
        cd "$API_DIR"
        DB_HOST="$pg_pub_host" \
        DB_PORT="$pg_pub_port" \
        DB_USERNAME=postgres \
        DB_PASSWORD="$pg_password" \
        DB_DATABASE=railway \
        DB_SYNCHRONIZE=true \
        NODE_ENV=production \
        npx ts-node -r tsconfig-paths/register src/scripts/init-system.ts 2>&1 | grep -E "(✅|⏭️|❌|✨|第.*步|角色数|权限数|管理员|完成|失败|开始)" || true
        cd "$ROOT_DIR"
        print_success "数据库初始化完成"
    else
        print_warn "无法自动初始化数据库，请手动运行:"
        echo "  ./scripts/deploy-railway.sh db:init"
    fi
    echo ""

    # 完成
    print_header "部署完成!"
    echo -e "  ${BOLD}API 地址:${NC}     ${GREEN}${api_url}${NC}"
    echo -e "  ${BOLD}Swagger 文档:${NC} ${GREEN}${api_url}/api/docs${NC}"
    echo -e "  ${BOLD}健康检查:${NC}     ${GREEN}${api_url}/api/health${NC}"
    echo ""
    echo -e "  ${BOLD}管理员账号:${NC}   admin"
    echo -e "  ${BOLD}管理员密码:${NC}   admin123"
    echo ""
    echo -e "  ${YELLOW}⚠  请立即修改默认管理员密码!${NC}"
    echo ""
    echo -e "  ${DIM}常用命令:${NC}"
    echo -e "  ${DIM}  查看日志:   ./scripts/deploy-railway.sh logs${NC}"
    echo -e "  ${DIM}  部署更新:   ./scripts/deploy-railway.sh deploy${NC}"
    echo -e "  ${DIM}  健康检查:   ./scripts/deploy-railway.sh health${NC}"
    echo ""
}

# 部署代码更新
cmd_deploy() {
    print_header "部署代码更新"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"

    print_step "上传并部署..."
    railway up --detach
    echo ""
    print_success "代码已上传，构建中"
    print_info "查看构建日志: ./scripts/deploy-railway.sh logs:build"
    print_info "查看运行日志: ./scripts/deploy-railway.sh logs"
    echo ""
}

# 查看运行日志
cmd_logs() {
    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"
    switch_to_service "$SERVICE_NAME"
    railway logs
}

# 查看构建日志
cmd_logs_build() {
    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"
    switch_to_service "$SERVICE_NAME"
    railway logs --build
}

# 初始化数据库
cmd_db_init() {
    print_header "初始化数据库"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    # 获取公网数据库信息
    switch_to_service "Postgres"
    local pg_password pg_pub_host pg_pub_port
    pg_password=$(railway variables 2>/dev/null | grep "PGPASSWORD" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_host=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_DOMAIN" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_port=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_PORT" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)

    switch_to_service "$SERVICE_NAME"

    if [ -z "$pg_password" ] || [ -z "$pg_pub_host" ]; then
        print_error "无法获取数据库连接信息"
        exit 1
    fi

    print_step "运行系统初始化脚本..."
    print_info "连接地址: $pg_pub_host:$pg_pub_port"
    echo ""

    cd "$API_DIR"
    DB_HOST="$pg_pub_host" \
    DB_PORT="$pg_pub_port" \
    DB_USERNAME=postgres \
    DB_PASSWORD="$pg_password" \
    DB_DATABASE=railway \
    DB_SYNCHRONIZE=true \
    NODE_ENV=production \
    npx ts-node -r tsconfig-paths/register src/scripts/init-system.ts 2>&1 | grep -E "(✅|⏭️|❌|✨|第.*步|角色|权限|管理员|完成|失败|开始|=)" || true

    cd "$ROOT_DIR"
    echo ""
    print_success "数据库初始化完成"
}

# 运行种子脚本
cmd_db_seed() {
    print_header "运行种子数据脚本"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    echo "  选择要运行的种子脚本:"
    echo ""
    echo "  1) init-system    — 完整初始化（角色+权限+管理员）"
    echo "  2) seed-admin     — 管理员种子数据"
    echo "  3) seed-data      — 业务数据（Provider + 模型）"
    echo "  4) seed-permissions — 权限种子数据"
    echo ""
    read -p "  请选择 [1-4]: " choice

    local script_name
    case $choice in
        1) script_name="init-system" ;;
        2) script_name="seed-admin" ;;
        3) script_name="seed-data" ;;
        4) script_name="seed-permissions" ;;
        *)
            print_error "无效选择"
            exit 1
            ;;
    esac

    # 获取数据库信息
    switch_to_service "Postgres"
    local pg_password pg_pub_host pg_pub_port
    pg_password=$(railway variables 2>/dev/null | grep "PGPASSWORD" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_host=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_DOMAIN" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_port=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_PORT" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    switch_to_service "$SERVICE_NAME"

    print_step "运行脚本: $script_name"
    cd "$API_DIR"

    if [ "$script_name" = "seed-data" ]; then
        # seed-data 是先 build 再 node 运行
        pnpm run build
        DB_HOST="$pg_pub_host" DB_PORT="$pg_pub_port" DB_USERNAME=postgres \
        DB_PASSWORD="$pg_password" DB_DATABASE=railway DB_SYNCHRONIZE=true NODE_ENV=production \
        node dist/apps/server/src/scripts/seed-data.js 2>&1 | grep -v "^query:" || true
    else
        DB_HOST="$pg_pub_host" DB_PORT="$pg_pub_port" DB_USERNAME=postgres \
        DB_PASSWORD="$pg_password" DB_DATABASE=railway DB_SYNCHRONIZE=true NODE_ENV=production \
        npx ts-node -r tsconfig-paths/register "src/scripts/${script_name}.ts" 2>&1 | grep -E "(✅|⏭️|❌|✨|完成|失败|开始|=)" || true
    fi

    cd "$ROOT_DIR"
    echo ""
    print_success "种子脚本执行完成"
}

# 连接数据库
cmd_db_connect() {
    print_header "连接数据库"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "Postgres"
    local pg_password pg_pub_host pg_pub_port
    pg_password=$(railway variables 2>/dev/null | grep "PGPASSWORD" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_host=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_DOMAIN" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_port=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_PORT" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    switch_to_service "$SERVICE_NAME"

    if command -v psql &> /dev/null; then
        print_info "通过 psql 连接: $pg_pub_host:$pg_pub_port"
        PGPASSWORD="$pg_password" psql -h "$pg_pub_host" -p "$pg_pub_port" -U postgres -d railway
    else
        print_warn "psql 未安装，尝试 railway connect..."
        switch_to_service "Postgres"
        railway connect
    fi
}

# 备份数据库
cmd_db_backup() {
    print_header "备份数据库"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    mkdir -p "$BACKUP_DIR"

    switch_to_service "Postgres"
    local pg_password pg_pub_host pg_pub_port
    pg_password=$(railway variables 2>/dev/null | grep "PGPASSWORD" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_host=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_DOMAIN" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_port=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_PORT" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    switch_to_service "$SERVICE_NAME"

    local backup_file="$BACKUP_DIR/railway_backup_$(date +%Y%m%d_%H%M%S).sql"
    print_step "正在备份到 $backup_file ..."

    PGPASSWORD="$pg_password" pg_dump -h "$pg_pub_host" -p "$pg_pub_port" -U postgres railway > "$backup_file"

    local size
    size=$(du -h "$backup_file" | awk '{print $1}')
    print_success "备份完成! 文件大小: $size"
    print_info "备份文件: $backup_file"
}

# 恢复数据库
cmd_db_restore() {
    print_header "恢复数据库"

    local backup_file="$1"
    if [ -z "$backup_file" ]; then
        # 列出备份文件
        if [ -d "$BACKUP_DIR" ] && [ "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
            echo "  可用的备份文件:"
            echo ""
            ls -lt "$BACKUP_DIR"/*.sql 2>/dev/null | head -10 | awk '{print "    " $NF " (" $5 " bytes, " $6 " " $7 " " $8 ")"}'
            echo ""
            read -p "  输入要恢复的文件路径: " backup_file
        else
            print_error "没有找到备份文件"
            echo "  请指定文件: ./scripts/deploy-railway.sh db:restore <file.sql>"
            exit 1
        fi
    fi

    if [ ! -f "$backup_file" ]; then
        print_error "文件不存在: $backup_file"
        exit 1
    fi

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "Postgres"
    local pg_password pg_pub_host pg_pub_port
    pg_password=$(railway variables 2>/dev/null | grep "PGPASSWORD" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_host=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_DOMAIN" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    pg_pub_port=$(railway variables 2>/dev/null | grep "RAILWAY_TCP_PROXY_PORT" | awk -F'│' '{print $3}' | tr -d ' ' | tr -d '\n' || true)
    switch_to_service "$SERVICE_NAME"

    echo -e "  ${YELLOW}⚠  警告: 恢复操作将覆盖现有数据!${NC}"
    read -p "  确认恢复? (y/N) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_step "正在恢复..."
        PGPASSWORD="$pg_password" psql -h "$pg_pub_host" -p "$pg_pub_port" -U postgres -d railway < "$backup_file"
        print_success "数据库恢复完成"
    else
        print_warn "已取消"
    fi
}

# 健康检查
cmd_health() {
    print_header "健康检查"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"

    # 获取域名
    local domain
    domain=$(railway domain 2>/dev/null | grep -o 'https://[^ ]*' | head -1 || true)

    if [ -z "$domain" ]; then
        print_error "未找到服务域名，请先部署并生成域名"
        exit 1
    fi

    echo -e "  ${BOLD}服务地址:${NC} $domain"
    echo ""

    # 存活检查
    print_step "存活探针 (liveness)"
    local live_resp
    live_resp=$(curl -s --max-time 10 "$domain/api/health/live" 2>/dev/null || echo "FAILED")
    if echo "$live_resp" | grep -q '"alive":true' 2>/dev/null; then
        print_success "存活: OK"
    else
        print_error "存活: FAILED"
        echo "  响应: $live_resp"
    fi

    # 就绪检查
    print_step "就绪探针 (readiness)"
    local ready_resp
    ready_resp=$(curl -s --max-time 10 "$domain/api/health/ready" 2>/dev/null || echo "FAILED")
    if echo "$ready_resp" | grep -q '"ready":true' 2>/dev/null; then
        print_success "就绪: OK"
    else
        print_error "就绪: FAILED"
        echo "  响应: $ready_resp"
    fi

    # 完整健康状态
    print_step "完整状态"
    local health_resp
    health_resp=$(curl -s --max-time 10 "$domain/api/health" 2>/dev/null || echo "FAILED")
    if command -v python3 &>/dev/null; then
        echo "$health_resp" | python3 -m json.tool 2>/dev/null | sed 's/^/  /' || echo "  $health_resp"
    else
        echo "  $health_resp"
    fi
    echo ""
}

# 查看服务状态
cmd_status() {
    print_header "服务状态"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    railway status
    echo ""

    switch_to_service "$SERVICE_NAME"
    echo -e "${BOLD}API 服务:${NC}"
    railway service status 2>/dev/null || true
    echo ""
}

# 查看环境变量
cmd_env() {
    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"
    railway variables
}

# 批量设置环境变量
cmd_env_set() {
    print_header "设置环境变量"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"

    if [ $# -eq 0 ]; then
        echo "  用法: ./scripts/deploy-railway.sh env:set KEY1=VAL1 KEY2=VAL2 ..."
        echo ""
        echo "  示例:"
        echo "    ./scripts/deploy-railway.sh env:set LOG_LEVEL=warn"
        echo "    ./scripts/deploy-railway.sh env:set OKX_API_KEY=xxx OKX_SECRET_KEY=yyy"
        echo ""
        exit 1
    fi

    local set_args=""
    for kv in "$@"; do
        set_args="$set_args --set \"$kv\""
    done

    eval "railway variables $set_args"
    print_success "环境变量已更新"
    print_info "更新环境变量会自动触发重新部署"
}

# 重启
cmd_restart() {
    print_header "重启服务"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"
    railway restart
    print_success "服务正在重启..."
}

# 重新部署
cmd_redeploy() {
    print_header "重新部署"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"
    railway redeploy
    print_success "正在重新构建和部署..."
}

# 回滚
cmd_rollback() {
    print_header "回滚部署"

    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"

    echo -e "  ${YELLOW}⚠  将移除最近一次部署并恢复到之前的版本${NC}"
    read -p "  确认回滚? (y/N) " -n 1 -r
    echo ""

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        railway down
        print_success "已回滚到上一次部署"
    else
        print_warn "已取消"
    fi
}

# 域名管理
cmd_domain() {
    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    switch_to_service "$SERVICE_NAME"
    railway domain
}

# 打开控制台
cmd_open() {
    check_railway_cli
    check_project_linked
    cd "$ROOT_DIR"

    railway open
}

# 销毁项目
cmd_destroy() {
    print_header "销毁 Railway 项目"

    check_railway_cli
    check_project_linked

    echo -e "  ${RED}╔══════════════════════════════════════════╗${NC}"
    echo -e "  ${RED}║  ⚠  危险操作：将永久删除项目和所有数据  ║${NC}"
    echo -e "  ${RED}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "  ${YELLOW}此操作将:${NC}"
    echo "    - 删除 API 服务及所有部署"
    echo "    - 删除 PostgreSQL 数据库和所有数据"
    echo "    - 删除所有环境变量和域名"
    echo ""
    read -p "  输入 'DELETE' 确认删除: " confirm

    if [ "$confirm" = "DELETE" ]; then
        cd "$ROOT_DIR"
        railway delete
        print_success "项目已删除"
    else
        print_warn "已取消"
    fi
}

# 帮助信息
cmd_help() {
    echo ""
    echo -e "${BOLD}Railway 部署脚本 — API Server (NestJS)${NC}"
    echo ""
    echo -e "${BOLD}用法:${NC}"
    echo "  ./scripts/deploy-railway.sh <命令> [参数]"
    echo ""
    echo -e "${BOLD}部署命令:${NC}"
    echo -e "  ${GREEN}init${NC}         首次完整部署（创建项目 + 数据库 + 部署 + 初始化）"
    echo -e "  ${GREEN}deploy${NC}       部署代码更新"
    echo -e "  ${GREEN}redeploy${NC}     重新构建并部署"
    echo -e "  ${GREEN}restart${NC}      重启服务（不重新构建）"
    echo -e "  ${GREEN}rollback${NC}     回滚到上一次部署"
    echo ""
    echo -e "${BOLD}数据库命令:${NC}"
    echo -e "  ${GREEN}db:init${NC}      初始化数据库（角色+权限+管理员）"
    echo -e "  ${GREEN}db:seed${NC}      运行种子数据脚本（可选择脚本）"
    echo -e "  ${GREEN}db:connect${NC}   连接数据库 Shell (psql)"
    echo -e "  ${GREEN}db:backup${NC}    备份数据库到本地文件"
    echo -e "  ${GREEN}db:restore${NC}   从文件恢复数据库"
    echo ""
    echo -e "${BOLD}监控命令:${NC}"
    echo -e "  ${GREEN}logs${NC}         查看运行日志"
    echo -e "  ${GREEN}logs:build${NC}   查看构建日志"
    echo -e "  ${GREEN}health${NC}       运行健康检查"
    echo -e "  ${GREEN}status${NC}       查看服务状态"
    echo ""
    echo -e "${BOLD}配置命令:${NC}"
    echo -e "  ${GREEN}env${NC}          查看环境变量"
    echo -e "  ${GREEN}env:set${NC}      设置环境变量 (KEY=VALUE ...)"
    echo -e "  ${GREEN}domain${NC}       查看/生成域名"
    echo ""
    echo -e "${BOLD}其他命令:${NC}"
    echo -e "  ${GREEN}open${NC}         打开 Railway 控制台"
    echo -e "  ${GREEN}destroy${NC}      销毁项目（${RED}危险${NC}）"
    echo -e "  ${GREEN}help${NC}         显示此帮助信息"
    echo ""
    echo -e "${BOLD}示例:${NC}"
    echo "  ./scripts/deploy-railway.sh init                           # 首次部署"
    echo "  ./scripts/deploy-railway.sh deploy                         # 更新部署"
    echo "  ./scripts/deploy-railway.sh env:set LOG_LEVEL=warn         # 修改日志级别"
    echo "  ./scripts/deploy-railway.sh db:backup                      # 备份数据库"
    echo "  ./scripts/deploy-railway.sh db:restore backup.sql          # 恢复数据"
    echo ""
}

# ─── 主入口 ───────────────────────────────────────────────────────────────────

case "${1:-help}" in
    init)
        cmd_init
        ;;
    deploy)
        cmd_deploy
        ;;
    logs)
        cmd_logs
        ;;
    logs:build)
        cmd_logs_build
        ;;
    db:init)
        cmd_db_init
        ;;
    db:seed)
        shift
        cmd_db_seed "$@"
        ;;
    db:connect)
        cmd_db_connect
        ;;
    db:backup)
        cmd_db_backup
        ;;
    db:restore)
        shift
        cmd_db_restore "$@"
        ;;
    health)
        cmd_health
        ;;
    status)
        cmd_status
        ;;
    env)
        cmd_env
        ;;
    env:set)
        shift
        cmd_env_set "$@"
        ;;
    restart)
        cmd_restart
        ;;
    redeploy)
        cmd_redeploy
        ;;
    rollback)
        cmd_rollback
        ;;
    domain)
        cmd_domain
        ;;
    open)
        cmd_open
        ;;
    destroy)
        cmd_destroy
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        print_error "未知命令: $1"
        cmd_help
        exit 1
        ;;
esac
