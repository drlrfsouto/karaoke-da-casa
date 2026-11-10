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

## Busca de músicas sem chave de API (novo)

O endpoint `/api/youtube/search` agora tem **duas fontes**:

| Fonte | Como funciona | Tempo | Precisa de quê |
|---|---|---|---|
| **pública** (primária) | o mesmo endpoint JSON que o site do YouTube usa (`youtubei/v1/search`) | ~0,5 s | nada |
| **yt-dlp** (reserva) | binário local, formato `ytsearch10:` | ~6 s | `yt-dlp` instalado |

A resposta virou `{ source, ms, results }`. O campo `source` diz qual fonte
respondeu (`publica`, `yt-dlp (reserva)` ou `nenhuma`) e aparece no console do
navegador como `[busca] fonte=publica`. Para testar cada fonte isolada:

```bash
curl "http://localhost:8787/api/youtube/search?q=evidencias&mode=ytdlp"
curl "http://localhost:8787/api/youtube/search?q=evidencias&mode=public"
```

Cada resultado traz `videoId`, `title`, `channelTitle` e `duration` ("4:58"),
que agora aparece no card do celular.

**Sobre o YouKaraokê (youkaraoke.com.br):** o site não tem API própria de músicas —
ele chama a YouTube Data API v3 (com chave dele) por uma função no Supabase. O
`robots.txt` deles tem `Disallow: /api/`, então apontar um scraper para lá não é uma
boa ideia, e o catálogo deles também não tem letra sincronizada nem nota por microfone.
A busca pública acima entrega o mesmo resultado sem depender de ninguém.

## Catálogo pronto: TVKaraokê (novo)

`tools/importar_tvkaraoke.py` lê os sitemaps públicos do **tvkaraoke.com.br**
(24.472 músicas já triadas como karaokê de verdade) e gera um JSON:

```bash
python3 tools/importar_tvkaraoke.py --limit 200          # amostra rápida
python3 tools/importar_tvkaraoke.py --all --workers 12   # catálogo completo (~1 h)
```

Depois, no celular: aba **Músicas** → **Importar catálogo (JSON)** → escolha o arquivo.
As músicas entram na biblioteca e passam a aparecer na busca.

Observações: são ~4,9 músicas/s com 8 workers; o script usa só a biblioteca padrão do
Python (sem `pip install`); e o catálogo é curadoria de terceiros — use em casa.

### Deixando o catálogo bonito (`enriquecer_catalogo.py`)

O TVKaraokê guarda nomes de arquivo ("Anitta Capa De Revista", sem acento). O script
`tools/enriquecer_catalogo.py` consulta o **oEmbed público do YouTube** (0,03 s por vídeo,
sem chave) e reescreve cada linha como `Artista — Título`:

```bash
python3 tools/enriquecer_catalogo.py --in catalogo.json --out catalogo-bonito.json
python3 tools/enriquecer_catalogo.py --in catalogo.json --out catalogo-bonito.json \
        --descartar-nao-karaoke      # remove o que não é karaokê/playback
```

O que ele conserta: separa artista e título (por espaço duplo ou hífen), corrige acentuação
de palavras comuns ("Ate" → "Até", "Alianca" → "Aliança"), arruma conectivos
("Até O Amanhecer" → "Até o Amanhecer"), remove emoji e "(Karaoke)" do nome, converte título
todo em MAIÚSCULA para caixa normal e marca cada música com `karaoke: true/false`.

Cache: `.cache-oembed.json` ao lado da saída — rodar de novo não repete consultas.
Velocidade medida: **~390 vídeos/s** com 16 workers (24 mil em ~1 min depois da primeira passada;
a importação do TVKaraokê, essa sim, leva ~1 h porque exige 1 request por página).

O import no celular junta os dois campos: a biblioteca guarda `Artista — Título`, então a
busca acha tanto por "Aviões" quanto por "Vou Virar Fazendeiro".

## Nota da plateia (novo)

Quando uma música começa, a TV abre a votação automaticamente. Cada convidado vota
de 0 a 10 no celular (pode trocar o voto até a música acabar) e a TV mostra a média
ao vivo no canto superior direito.

A nota final passa a ser:

| Situação | Cálculo |
|---|---|
| microfone + plateia | `70% voz + 30% plateia` |
| só microfone | nota da voz |
| só plateia | média da plateia (0–10 → 0–99) |
| nenhum dos dois | modo festa (sorteio) |

Rotas: `POST /api/rooms/:code/crowd/open`, `/crowd/close` e `/crowd/vote`
(`{userId, name, score}`). O voto é por participante, um por música.

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
3. **Erro 153 do YouTube (importante)**: desde o fim de 2025 o player incorporado exige a
   identificação do site (cabeçalho `Referer`). O app agora manda `referrer` na página e
   `origin`/`widget_referrer` no player, e a TV tem um botão **"Abrir no YouTube"** como
   saída. **Ao rodar por `http://localhost:3000` funciona**; abrindo o HTML direto do disco
   (`file://`) o navegador não envia `Referer` e o YouTube recusa — use o servidor local.
4. **Busca é do YouTube**: o topo dos resultados muda com o tempo. A busca agora usa
   "karaokê" quando a consulta é em português (antes vinha versão em espanhol de "Evidências"),
   mas escolher a versão certa no celular continua sendo o caminho mais confiável.
5. **Nota da dupla**: os dois cantores recebem a mesma nota (o microfone é um só).
6. **Sem ajuste de tom**: não há transposição nem guia vocal separado; o playback é o vídeo.
7. **Celular não mede voz**: apenas a TV tem microfone; quem escolhe a música usa o celular.

---

## Catálogo grande de verdade (24 mil músicas)

Importar o catálogo do TVKaraokê no celular precisava aguentar o volume. Antes, cada
música virava uma requisição (24 mil idas ao servidor) e a biblioteca inteira era
baixada no aparelho. Agora:

| Antes | Agora |
|---|---|
| 24 mil POSTs, uma música por vez | **1 POST** `/api/songs/import` — `createMany` em lotes de 1000 |
| biblioteca inteira baixada no celular | `GET /api/songs?limit=300` traz as mais recentes + `total` |
| busca só nas músicas já baixadas | **`GET /api/songs/search?q=`** procura no catálogo inteiro |
| busca exigia acento igual ("Aviões") | busca **ignora acento, maiúscula e ordem**: "avioes", "AVIOES DO FORRO", "forro avioes" |

- **Coluna `search_key`** (`backend/prisma/schema.prisma` + `lib/text.ts`): o título é
  gravado sem acento, em minúsculas e sem pontuação. A busca usa `contains` sobre ela,
  com índice. Quem já tinha biblioteca ganha o índice na subida do servidor
  (`backfillSearchKeys`), sem reimportar nada.
- **Medido com o catálogo real de 24.456 músicas**: importação em **2,0 s** (`bodyLimit`
  de 40 MB nessa rota); busca no catálogo inteiro em **8–16 ms**; reimportar o mesmo
  arquivo devolve `inseridas: 0, atualizadas: 0` (não duplica).
- **Reimportar atualiza os nomes**: `POST /api/songs/import` com `atualizar: true`
  renomeia no lugar (`INSERT ... ON CONFLICT DO UPDATE ... WHERE título mudou`), sem
  perder `playCount` nem histórico. Foi assim que o catálogo passou de 12 mil para 24 mil
  sem duplicar e os títulos melhorados substituíram os antigos.
- O importador do TVKaraokê também ficou **retomável**: o progresso vai para
  `catalogo.parcial.jsonl`; se cair no meio, rodar o mesmo comando continua de onde parou
  (`--retry-falhas` para tentar as que falharam, `--reset` para começar do zero).

**Receita completa** (na sua máquina, um comando por passo):

```bash
python3 tools/importar_tvkaraoke.py --all --workers 12 --out catalogo.json   # ~50 min, retomável
python3 tools/enriquecer_catalogo.py --in catalogo.json --out catalogo-bonito.json  # ~1 min
# celular > aba "Músicas" > "Escolher arquivo" > catalogo-bonito.json
```

## Próximos passos sugeridos (em ordem de retorno)

- Tela de "modo festa": fila automática sem precisar apertar "Começar".
- Guardar histórico de notas por música (`Score` no Prisma) para evoluir o ranking.
- Detecção de "cantou a nota certa" comparando com a melodia extraída do próprio vídeo
  (mais preciso que firmeza; exige separar voz do playback).
