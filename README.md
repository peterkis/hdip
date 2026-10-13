# HDIP

医院级数据资产治理与智能运营基础平台（Hospital Data Intelligence Platform）轻量 MVP：主体、院区、服务单元维护。

- 设计文档：[docs/HDIP 轻量 MVP 设计：主体、院区、服务单元维护.md](docs/HDIP%20轻量%20MVP%20设计：主体、院区、服务单元维护.md)
- 开发约定：[CLAUDE.md](CLAUDE.md)

## 快速开始

需要 Docker、[uv](https://docs.astral.sh/uv/)、Node.js 20+。

```bash
cp .env.example .env
make db                      # PostgreSQL 16
cd api && uv sync && cd ..
make migrate
cd web && npm install && cd ..
make api                     # 终端 1：http://localhost:8000/docs
make web                     # 终端 2：http://localhost:5173
```
