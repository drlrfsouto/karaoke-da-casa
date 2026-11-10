# 🎤 Karaokê da Casa (base: Karaokêando)

Fork do [Karaokêando](https://github.com/Andrechiapetta/karaokeando) (MIT) — salas por
código, celular como controle, fila compartilhada, duetos e ranking em PostgreSQL —
**com duas coisas que o original não tinha**:

- 🎵 **letra sincronizada** na tela da TV (LRCLib, casada pela duração do vídeo);
- 🎙️ **pontuação medida no microfone** (altura, firmeza, alcance) em vez da nota sorteada.

Detalhes técnicos e limites conhecidos: **[MELHORIAS.md](MELHORIAS.md)**.

> Créditos: o projeto original é de [Andre Luiz Da Silva Chiapetta](https://github.com/Andrechiapetta)
> ([Karaokêando](https://github.com/Andrechiapetta/karaokeando), licença MIT, mantida em `LICENSE`).
> As mudanças deste fork estão listadas em `MELHORIAS.md`.

---

## Sobre o projeto original (Karaokêando)

Sistema de karaokê social em tempo real. Crie salas, adicione músicas do YouTube, cante sozinho ou em dupla, e dispute o ranking com seus amigos!

## 📋 Visão Geral

O Karaokêando é uma aplicação web que transforma qualquer TV em um karaokê de festa. O host projeta a tela da TV, e os convidados usam seus celulares para adicionar músicas, escolher parceiros de dueto e acompanhar o ranking.

### Como funciona

1. **Host** cria uma sala e projeta a TV (`/room/XXXXX/tv`)
2. **Convidados** entram pelo celular escaneando QR code ou digitando o código
3. Pelo celular: buscam músicas, adicionam à fila, escolhem cantar solo ou em dupla
4. A TV exibe o vídeo com som, fila e ranking em tempo real
5. Ao finalizar, o sistema gera uma pontuação e atualiza o ranking

## 🏗️ Arquitetura

```
karaokeando/
├── backend/          # API Node.js + TypeScript
│   ├── src/
│   │   ├── server.ts    # Servidor Fastify + WebSocket
│   │   └── lib/         # Módulos (auth, songs, etc.)
│   └── prisma/          # Schema e migrations
│
├── frontend/         # React + Vite + TypeScript
│   ├── src/
│   │   ├── pages/       # Home, RoomTV, RoomMobile, Dashboard
│   │   ├── components/  # ScoreOverlay, etc.
│   │   ├── score/       # Sistema de pontuação
│   │   └── api.ts       # Cliente API + WebSocket
│   └── public/          # Assets estáticos
│
└── docker-compose.yml   # PostgreSQL local
```

## 🚀 Quick Start

### Pré-requisitos

- Node.js 20+
- npm 10+
- Docker (para PostgreSQL) ou PostgreSQL 16+
- **yt-dlp** no PATH (busca das músicas no YouTube)

### 1. Banco de dados

```bash
docker compose up -d        # PostgreSQL na porta 5433
```

### 2. Backend

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy   # cria as tabelas
npm run dev
```

Servidor rodando em `http://localhost:8787`

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Aplicação em `http://localhost:3000` — a TV abre em `/room/CODIGO/tv` e o celular em
`/room/CODIGO` (o QR code da TV já leva direto). Na TV, ligue o microfone em
**Ligar microfone e pontuar**.

## ✨ Funcionalidades

### Catálogo (24 mil músicas) ✅

O app já vem com o pipeline que monta um repertório de karaokê de verdade:

**Já tem o catálogo pronto aqui:** `catalogo-bonito.json.gz` (715 KB). Descompacte
(`gunzip catalogo-bonito.json.gz` no Linux/Mac, ou botão direito > extrair no Windows)
e importe pelo celular — não precisa rodar script nenhum.

Para refazer/atualizar o catálogo:

```bash
python3 tools/importar_tvkaraoke.py --all --workers 12 --out catalogo.json   # ~1 h, retomável
python3 tools/enriquecer_catalogo.py --in catalogo.json --out catalogo-bonito.json  # ~1 min
# no celular: aba "Músicas" > "Escolher arquivo" > catalogo-bonito.json
```

- **24.456 músicas** coletadas do catálogo público do TVKaraokê (curadoria de vídeos de karaokê do YouTube);
- títulos reais do YouTube, separados em **`Artista — Título`** ("Anitta Capa De Revista" → "Anitta — Capa de Revista");
- importação em **uma chamada** (24 mil em ~2 s) e reimportação que **renomeia sem duplicar**;
- busca **no catálogo inteiro, no servidor**, ignorando acento e maiúscula ("avioes" acha "Aviões do Forró") em ~10 ms.

Também existe `python3 tools/pipeline_catalogo.py`, que encadeia coleta + enriquecimento + importação.

### Implementadas ✅

- **Salas em tempo real** - Código de 5 caracteres, WebSocket para sync instantâneo
- **Busca de músicas** - Integração com YouTube via yt-dlp
- **Fila compartilhada** - Todos veem a mesma fila em tempo real
- **Solo ou Dueto** - Escolha cantar sozinho ou com um parceiro da sala
- **Ranking individual** - Pontuação acumulada por participante
- **Ranking de duplas** - Ranking separado para duetos
- **Letra sincronizada na TV** - LRC via LRCLib, casada pela duração do vídeo, com ajuste de ±0,3 s
- **Pontuação por microfone** - altura, firmeza na nota, notas longas e alcance vocal (sem sorteio)
- **Biblioteca de músicas** - Músicas adicionadas ficam salvas no banco
- **Mais tocadas** - Lista das músicas mais populares (persistido)
- **Dashboard admin** - Painel com salas ativas e top músicas
- **Identificação persistente** - ID único por dispositivo, nome salvo
- **PostgreSQL** - Persistência robusta com Prisma ORM
- **Sistema de autenticação** - JWT para hosts e acesso TV

### Roadmap 🚧

- [ ] **Sistema de usuários completo** - Cadastro, login, perfil
- [ ] **Histórico de sessões** - Ver festas anteriores
- [ ] **Favoritos pessoais** - Cada usuário salva suas músicas
- [ ] **Conquistas/Badges** - Gamificação
- [ ] **Temas visuais** - Personalização da sala

## 🛠️ Stack Tecnológica

### Backend

| Tecnologia         | Uso                   |
| ------------------ | --------------------- |
| Node.js            | Runtime               |
| TypeScript         | Tipagem               |
| Fastify            | Framework HTTP        |
| @fastify/websocket | Comunicação real-time |
| yt-dlp             | Busca no YouTube      |
| Prisma             | ORM                   |
| PostgreSQL 16      | Banco de dados        |
| JWT                | Autenticação          |

### Frontend

| Tecnologia   | Uso        |
| ------------ | ---------- |
| React 18     | UI Library |
| TypeScript   | Tipagem    |
| Vite         | Build tool |
| React Router | Navegação  |

## 📁 Estrutura de Dados

Dados persistidos no PostgreSQL via Prisma:

```
backend/prisma/
├── schema.prisma       # Schema do banco
└── migrations/         # Histórico de migrations
```

**Entidades implementadas:**

- `User` - Usuários cadastrados (email, nome, senha)
- `Room` - Salas de karaokê (código, hostId, tvToken)
- `RoomVisit` - Histórico de visitas às salas
- `Song` - Biblioteca de músicas (videoId, título, playCount)

**Dados em memória (efêmeros por sessão):**

- Fila de músicas da sala
- Ranking da sessão (solo e duplas)
- Conexões WebSocket

## 🔧 Variáveis de Ambiente

Criar arquivo `.env` na raiz do backend:

```env
# Servidor
PORT=8787

# Banco de dados
DATABASE_URL=postgresql://karaokeando:karaokeando@localhost:5433/karaokeando

# Autenticação
JWT_SECRET=sua-chave-secreta-aqui

# Admin
ADMIN_KEY=chave-do-dashboard
# (Em breve) Banco de dados
DATABASE_URL=postgresql://user:password@localhost:5432/karaokeando

# (Em breve) Autenticação
JWT_SECRET=sua-chave-secreta
```

## 📱 Rotas da Aplicação

| Rota             | Descrição                           |
| ---------------- | ----------------------------------- |
| `/`              | Home - Criar ou entrar em sala      |
| `/room/:code`    | Modo Mobile - Controle pelo celular |
| `/room/:code/tv` | Modo TV - Exibição principal        |
| `/dashboard`     | Painel administrativo               |

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

Feito com 🎤 e ❤️
