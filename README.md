# HDIP

医院级数据资产治理与智能运营基础平台（Hospital Data Intelligence Platform）轻量 MVP：主体、院区、服务单元维护。

- 设计文档：[docs/HDIP 轻量 MVP 设计：主体、院区、服务单元维护.md](docs/HDIP%20轻量%20MVP%20设计：主体、院区、服务单元维护.md)
- 开发约定：[CLAUDE.md](CLAUDE.md)

## 快速开始

需要 PostgreSQL 18（`brew install postgresql@18`）、[uv](https://docs.astral.sh/uv/)、Node.js 20+。Python 版本由 uv 按 `api/.python-version`（3.13）自动安装，无需另装。

```bash
cp .env.example .env         # 改成自己的密码
make db                      # 启动本机 PostgreSQL 18
make db-init                 # 建 hdip 账号与库，不动已有库
cd api && uv sync && cd ..
make migrate
cd web && npm install && cd ..
make api                     # 终端 1：http://localhost:8000/docs
make web                     # 终端 2：http://localhost:5173
```
