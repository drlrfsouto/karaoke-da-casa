# Karaokêando Frontend 🎤

Frontend **React + Vite + TypeScript** para o sistema de karaokê social.

## 🚀 Rodar (desenvolvimento)

```bash
cd karaokeando/frontend
npm install
npm run dev
```

Aplicação disponível em `http://localhost:3000`

## 📁 Estrutura

```
frontend/
├── src/
│   ├── pages/
│   │   ├── Home.tsx        # Página inicial - criar/entrar sala
│   │   ├── RoomTV.tsx      # Modo TV - exibição principal
│   │   ├── RoomMobile.tsx  # Modo Mobile - controle pelo celular
│   │   └── Dashboard.tsx   # Painel administrativo
│   │
│   ├── components/
│   │   └── ScoreOverlay.tsx  # Overlay de pontuação
│   │
│   ├── score/
│   │   ├── pikaraokeScore.ts   # Geração de pontuação
│   │   ├── pikaraokeReviews.ts # Frases de review
│   │   └── fireworks.ts        # Efeito de fogos
│   │
│   ├── api.ts     # Cliente API + WebSocket
│   ├── main.tsx   # Entry point
│   └── index.css  # Estilos globais
│
├── public/
│   ├── sounds/    # Efeitos sonoros
│   └── images/    # Imagens e assets
│
└── index.html     # Template HTML
```

## 📱 Páginas

| Rota             | Componente | Descrição                                    |
| ---------------- | ---------- | -------------------------------------------- |
| `/`              | Home       | Criar sala ou entrar em sala existente       |
| `/room/:code`    | RoomMobile | Controle pelo celular (busca, fila, ranking) |
| `/room/:code/tv` | RoomTV     | Exibição principal (TV com som)              |
| `/dashboard`     | Dashboard  | Painel de analytics e gestão                 |

## 🔧 Scripts

```bash
npm run dev      # Desenvolvimento com hot-reload
npm run build    # Build para produção
npm run preview  # Preview do build
```

## 🎨 Funcionalidades da UI

### RoomMobile (Celular)

- **Aba Fila**: Ver música atual, próximas, controles de play/pause
- **Aba Músicas**: Biblioteca salva, mais tocadas, busca YouTube
- **Aba Ranking**: Ranking solo e de duplas
- Modal de adicionar música com seleção de solo/dueto
- Tooltip para títulos longos truncados

### RoomTV (TV)

- Player YouTube em tela cheia
- Overlay de pontuação com efeitos visuais
- Fila lateral com controles de ordenação
- Ranking em tempo real

## 🔌 Comunicação com Backend

O arquivo `api.ts` gerencia:

- **REST API** - Chamadas HTTP para ações (criar sala, adicionar música, etc)
- **WebSocket** - Conexão real-time para sincronização de estado
- **localStorage** - Persistência de userId e nome do usuário

## 📦 Dependências Principais

- `react` + `react-dom` - UI Library
- `react-router-dom` - Roteamento SPA
- `vite` - Build tool e dev server

---

Parte do projeto [Karaokêando](../README.md)
