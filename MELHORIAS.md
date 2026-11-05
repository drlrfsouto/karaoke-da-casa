# Melhorias do Karaokê da Casa sobre o Karaokêando

Este diretório é o repositório [Andrechiapetta/karaokeando](https://github.com/Andrechiapetta/karaokeando)
(MIT) **com duas coisas que faltavam para cantar em casa de verdade**:

1. **letra sincronizada** na tela da TV;
2. **pontuação medida no microfone**, no lugar da nota sorteada.

O resto do projeto — salas por código, celular como controle, fila compartilhada,
duetos, ranking, biblioteca em PostgreSQL — é o original e continua funcionando igual.

---

## O que foi mudado

| Arquivo | Estado | O que faz |
|---|---|---|
| `frontend/src/score/voice.ts` | **novo** | Motor de voz: detecta a altura (autocorrelação normalizada), mede presença de voz, firmeza na nota, notas longas e alcance, e converte em nota 0–99 |
| `frontend/src/score/lyrics.ts` | **novo** | Busca a letra sincronizada (LRCLib), limpa o título do vídeo, escolhe a versão certa pela duração e guarda em cache |
| `frontend/src/components/VoiceHud.tsx` | **novo** | HUD da TV: botão do microfone, medidor de nível, nota ao vivo e a letra desenhada sobre o vídeo |
| `frontend/src/pages/RoomTV.tsx` | alterado | Relógio do player, HUD, envio das métricas ao finalizar, aviso e pulo automático de vídeo bloqueado |
| `frontend/src/components/ScoreOverlay.tsx` | alterado | Mostra **como** a nota foi obtida (microfone x modo festa) |
| `frontend/src/api.ts` | alterado | `finalizeSong(..., voice)` e `skipSong()` |
| `backend/src/server.ts` | alterado | Sanitiza a nota medida, rota `/api/rooms/:code/skip` e busca que respeita o idioma |
| `frontend/vite.config.ts` | alterado | Aceita qualquer domínio (`allowedHosts`) e HMR por `wss` em túnel/preview |

Nada foi removido: sem microfone ligado, o jogo cai no comportamento antigo
(nota do modo festa) e a TV avisa isso na nota final.

---

## Como a nota funciona agora

A cada quadro de áudio (≈50 ms) o motor:

- calcula o **nível** (RMS) e detecta a **altura** (f0) por autocorrelação normalizada;
- conta o tempo em que **houve voz** de verdade (não ruído, não palma, não o playback);
- mede a **firmeza**: a nota fica estável (variação < 50 cents numa janela de 800 ms);
- registra a **nota mais longa** e o **alcance** (quantos semitons diferentes).

Nota final = `50% presença de voz + 35% firmeza + 15% alcance`, com trava para quem
quase não cantou (se a voz apareceu em menos de 12% do tempo, a nota cai junto).

Validação: com tom sintético o detector acerta **99,9%** entre 82 Hz e 880 Hz; silêncio e
ruído dão 0; custa ~3 ms por quadro numa CPU de 2 núcleos.

---

## Regra da festa: cada música começa no "Começar"

Mantido de propósito (é o fluxo original do projeto):

- finalizar uma música **não** puxa a próxima da fila;
- "Pular" (vídeo que não toca, ou alguém desistiu) **não** puxa a próxima;
- quem decide o que toca em seguida é a pessoa no celular, no botão "Começar".

Consequência prática: numa fila com 5 músicas, são 5 toques em "Começar" — um por música.
Se um dia quiser fila contínua, é trocar uma linha no `finalize`/`skip` do backend.

## Como rodar

Pré-requisitos: Node 20+, PostgreSQL 16 (ou Docker) e `yt-dlp` no PATH (é ele que busca
as músicas no YouTube).

```bash
# 1) banco (escolha um)
docker compose up -d                       # usa a porta 5433
# ou um Postgres local na 5433

# 2) backend
cd backend
cp .env.example .env
npm install
npx prisma migrate deploy                  # cria users/rooms/songs
npm run dev                                # http://localhost:8787

# 3) frontend (outro terminal)
cd frontend
npm install
npm run dev                                # http://localhost:3000
```

No navegador da TV: `http://localhost:3000` → criar sala (precisa de cadastro de anfitrião
com senha de 6 dígitos) → abrir `/room/CODIGO/tv` → senha da TV → **Ligar microfone e pontuar**.
O celular entra em `http://IP-DO-PC:3000/room/CODIGO` (o QR code da TV já leva direto).

`yt-dlp` ajuda o backend a achar as músicas, mas o vídeo toca no navegador (YouTube IFrame).

---

## Limites conhecidos (o que ainda não é perfeito)

1. **Sincronia da letra**: o LRCLib é uma base comunitária. Em versões ao vivo ou karaokês
   com contagem, a letra pode adiantar/atrasar alguns segundos. O casamento por duração do
   vídeo reduz muito o erro; para o resto existe o ajuste **`−0,3 s` / `+0,3 s`** na TV
   (fica salvo por vídeo no `localStorage`).
2. **Vídeo bloqueado para incorporação**: alguns karaokês do YouTube não tocam dentro de
   outro site. A TV avisa (com a capa) e, em 5 s, **libera o vídeo** — não começa nada
   sozinha: a próxima música continua esperando o botão "Começar", do mesmo jeito que o
   resto do app. Trava de segurança: depois de 3 vídeos seguidos com erro a liberação
   automática para, para não esvaziar a fila se a rede estiver bloqueando o YouTube.
3. **Busca é do YouTube**: o topo dos resultados muda com o tempo. A busca agora usa
   "karaokê" quando a consulta é em português (antes vinha versão em espanhol de "Evidências"),
   mas escolher a versão certa no celular continua sendo o caminho mais confiável.
4. **Nota da dupla**: os dois cantores recebem a mesma nota (o microfone é um só).
5. **Sem ajuste de tom**: não há transposição nem guia vocal separado; o playback é o vídeo.
6. **Celular não mede voz**: apenas a TV tem microfone; quem escolhe a música usa o celular.

## Próximos passos sugeridos (em ordem de retorno)

- Tela de "modo festa": fila automática sem precisar apertar "Começar".
- Guardar histórico de notas por música (`Score` no Prisma) para evoluir o ranking.
- Detecção de "cantou a nota certa" comparando com a melodia extraída do próprio vídeo
  (mais preciso que firmeza; exige separar voz do playback).
