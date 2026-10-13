#!/usr/bin/env bash
# 在本机 Homebrew PostgreSQL 18 里建 HDIP 的账号和库（可重复执行，只动 hdip 相关对象）。
# 账号、密码、库名都取自仓库根目录 .env；用当前系统用户（brew 初始化时的超级用户）执行。
#   hdip_owner：表属主，跑迁移；有 CREATEDB，测试会建 <库名>_test。
#   hdip_app：应用运行账号；表权限（SELECT / INSERT / UPDATE，无 DELETE）由迁移 0002 授予。
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "缺少 .env：先 cp .env.example .env 并修改密码" >&2; exit 1; }

url_part() { # $1=变量名 $2=user|pass|db
  local url
  url=$(grep -E "^$1=" .env | head -1 | cut -d= -f2-)
  url=${url#*://}
  case $2 in
    user) echo "${url%%:*}" ;;
    pass) local rest=${url#*:}; echo "${rest%%@*}" ;;
    db) echo "${url##*/}" ;;
  esac
}

OWNER=$(url_part HDIP_MIGRATION_DATABASE_URL user)
OWNER_PW=$(url_part HDIP_MIGRATION_DATABASE_URL pass)
APP=$(url_part HDIP_DATABASE_URL user)
APP_PW=$(url_part HDIP_DATABASE_URL pass)
DB=$(url_part HDIP_MIGRATION_DATABASE_URL db)

psql -d postgres -v ON_ERROR_STOP=1 -q \
  -v owner="$OWNER" -v owner_pw="$OWNER_PW" -v app="$APP" -v app_pw="$APP_PW" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN CREATEDB', :'owner')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner') \gexec
SELECT format('CREATE ROLE %I LOGIN', :'app')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'owner', :'owner_pw') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app', :'app_pw') \gexec
SQL

if [ -z "$(psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$DB'")" ]; then
  psql -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE \"$DB\" OWNER \"$OWNER\" ENCODING 'UTF8'"
  echo "已创建数据库 $DB（属主 $OWNER）"
else
  echo "数据库 $DB 已存在，跳过"
fi
echo "账号 $OWNER / $APP 就绪。下一步：make migrate"
