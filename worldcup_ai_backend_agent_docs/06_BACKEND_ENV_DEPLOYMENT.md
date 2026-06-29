# 06 BACKEND ENV AND DEPLOYMENT

本文件只包含後端需要的環境與部署。不要設定前端 Vercel UI，除非只是提供 `FRONTEND_URL`。

# 10 Environment and Deployment Runbook

## Local Development

建議：Node.js LTS、pnpm、Docker、Docker Compose。

```bash
pnpm install
docker compose up -d
cd apps/api
pnpm prisma generate
pnpm prisma migrate dev
pnpm prisma db seed
pnpm start:dev
```

前端：

```bash
cd apps/web
pnpm dev
```

## docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16
    container_name: worldcup_ai_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: worldcup
      POSTGRES_PASSWORD: worldcup
      POSTGRES_DB: worldcup_ai
    ports:
      - "5432:5432"
    volumes:
      - worldcup_ai_pg:/var/lib/postgresql/data
volumes:
  worldcup_ai_pg:
```

## Backend `.env.example`

```env
NODE_ENV=development
PORT=3000
APP_BASE_URL=http://localhost:3000
API_GLOBAL_PREFIX=api
FRONTEND_URL=http://localhost:3001
DATABASE_URL=postgresql://worldcup:worldcup@localhost:5432/worldcup_ai
JWT_SECRET=replace-with-long-random-secret
COOKIE_SECRET=replace-with-long-random-secret
CRON_SECRET=replace-with-long-random-secret
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=admin123456
SEED_ADMIN_DISPLAY_NAME=Initial Admin
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL_SUPER=nvidia/nemotron-3-super-120b-a12b
NVIDIA_MODEL_ULTRA=nvidia/nemotron-3-ultra-550b-a55b
DASHSCOPE_API_KEY=
QWEN_OPENAI_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
QWEN_DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/api/v1
QWEN_MODEL_PLUS=qwen3.7-plus
QWEN_MODEL_FLASH=qwen3.6-flash
QWEN_MODEL_FLASH_FALLBACK=qwen3.5-flash
FOOTBALL_DATA_API_KEY=
GUARDIAN_API_KEY=
NEWS_API_KEY=
AI_MOCK_MODE=true
```



## Backend Only Secrets

The following must only exist in backend runtime:

```env
DATABASE_URL=
JWT_SECRET=
COOKIE_SECRET=
CRON_SECRET=
NVIDIA_API_KEY=
DASHSCOPE_API_KEY=
FOOTBALL_DATA_API_KEY=
GUARDIAN_API_KEY=
NEWS_API_KEY=
```

## Do Not Expose

Never commit or print real secrets.
