# Karaokêando Backend 🎤

Backend **Node.js + TypeScript** (Fastify + WebSocket) para o sistema de karaokê social.

## 🚀 Rodar (desenvolvimento)

```bash
cd karaokeando/backend
npm install
npm run dev
```

Servidor disponível em `http://localhost:8787`

## 📁 Estrutura

```
backend/
├── src/
│   ├── server.ts      # Servidor Fastify + WebSocket + Rotas
│   └── lib/
│       ├── auth.ts    # Autenticação JWT
│       ├── prisma.ts  # Cliente Prisma
│       └── songs.ts   # Operações de músicas no banco
│
├── prisma/
│   ├── schema.prisma  # Schema do banco de dados
│   └── migrations/    # Histórico de migrations
│
└── app/               # (Reservado para módulos futuros)
```

## 🔌 API Endpoints

### Salas

| Método | Rota                            | Descrição              |
| ------ | ------------------------------- | ---------------------- |
| POST   | `/api/rooms`                    | Criar nova sala        |
| GET    | `/api/rooms/:code/state`        | Estado atual da sala   |
| GET    | `/api/rooms/:code/participants` | Lista de participantes |

### Fila de Músicas

| Método | Rota                              | Descrição                 |
| ------ | --------------------------------- | ------------------------- |
| POST   | `/api/rooms/:code/enqueue`        | Adicionar música à fila   |
| POST   | `/api/rooms/:code/next`           | Pular para próxima música |
| POST   | `/api/rooms/:code/finalize`       | Finalizar e pontuar       |
| DELETE | `/api/rooms/:code/queue/:id`      | Remover da fila           |
| POST   | `/api/rooms/:code/queue/:id/move` | Mover na fila             |
| POST   | `/api/rooms/:code/queue/:id/top`  | Mover para o topo         |

### Biblioteca

| Método | Rota               | Descrição             |
| ------ | ------------------ | --------------------- |
| GET    | `/api/library`     | Listar músicas salvas |
| DELETE | `/api/library/:id` | Remover música        |
| GET    | `/api/library/top` | Músicas mais tocadas  |

### Busca

| Método | Rota                     | Descrição         |
| ------ | ------------------------ | ----------------- |
| GET    | `/api/youtube/search?q=` | Buscar no YouTube |

### Usuários

| Método | Rota                           | Descrição                 |
| ------ | ------------------------------ | ------------------------- |
| POST   | `/api/rooms/:code/update-name` | Atualizar nome do usuário |

### WebSocket

| Rota                                                         | Descrição           |
| ------------------------------------------------------------ | ------------------- |
| `ws://localhost:8787/ws/:code?mode=tv`                       | Conexão modo TV     |
| `ws://localhost:8787/ws/:code?mode=mobile&name=X&odUserId=Y` | Conexão modo Mobile |

## 📡 Eventos WebSocket

### Cliente → Servidor

```typescript
{ type: "HELLO", name: string, odUserId: string }  // Identificação
{ type: "PLAYER_COMMAND", command: "play" | "pause" }  // Controle player
```

### Servidor → Cliente

```typescript
{ type: "STATE", state: RoomState }  // Estado completo
{ type: "PARTICIPANTS", participants: [...] }  // Lista de participantes
{ type: "FINALIZED", singer: string, score: number, title: string }  // Música finalizada
{ type: "SCORE_DONE" }  // Overlay de score terminou
{ type: "PLAYER_COMMAND", command: "play" | "pause" }  // Comando do player
```

## 🗄️ Estrutura de Dados (Atual)

### RoomState

```typescript
interface RoomState {
  code: string;
  createdAt: number;
  nowPlaying: QueueItem | null;
  queue: QueueItem[];
  ranking: Record<string, RankingEntry>;
  duetRanking: Record<string, DuetRankingEntry>;
  showingScore: boolean;
}
```

### QueueItem

```typescript
interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  requestedBy: string;
  singers: { id: string; name: string }[];
}
```

## 🗃️ PostgreSQL + Prisma

### Setup do Banco

```bash
# Subir PostgreSQL via Docker
docker-compose up -d

# Rodar migrations
npx prisma migrate dev

# Ver dados no Prisma Studio
npx prisma studio
```

### Schema Atual

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  name         String
  passwordHash String?
  phone        String?
  canHost      Boolean  @default(false)
  createdAt    DateTime @default(now())
  ownedRooms   Room[]   @relation("RoomOwner")
}

model Room {
  id             String   @id @default(uuid())
  code           String   @unique
  ownerId        String
  owner          User     @relation("RoomOwner", fields: [ownerId], references: [id])
  tvPasswordHash String
  uniqueVisitors Int      @default(0)
  createdAt      DateTime @default(now())
}

model Song {
  id           String    @id @default(uuid())
  videoId      String    @unique
  title        String
  addedBy      String
  playCount    Int       @default(0)
  lastPlayedAt DateTime?
  createdAt    DateTime  @default(now())
}
```

## 🔧 Variáveis de Ambiente

```env
# Servidor
PORT=8787

# Banco de dados
DATABASE_URL=postgresql://karaokeando:karaokeando@localhost:5433/karaokeando

# Autenticação
JWT_SECRET=sua-chave-secreta-jwt

# Admin Dashboard
ADMIN_KEY=chave-admin-dashboard
```

## 📦 Dependências

### Produção

- `fastify` - Framework HTTP rápido
- `@fastify/cors` - CORS middleware
- `@fastify/websocket` - Suporte WebSocket
- `@prisma/client` - Cliente do banco
- `jsonwebtoken` - Autenticação JWT
- `bcrypt` - Hash de senhas

### Desenvolvimento

- `tsx` - Executor TypeScript
- `typescript` - Compilador
- `prisma` - CLI do Prisma

## 🏥 Health Check

```bash
curl http://localhost:8787/health
# {"status":"ok"}
```

---

Parte do projeto [Karaokêando](../README.md)
