# Como publicar no GitHub

Repositório de destino: **https://github.com/drlrfsouto/karaoke-da-casa** (já existe, é público, MIT).

## Situação deste pacote

Esta pasta **já tem o histórico do repositório** dentro do `.git`, alinhado com o que
está no GitHub, mais **1 commit novo**:

```
68d4ee8  Catálogo de 24 mil músicas + busca sem acento no servidor   <-- sobe agora
d4add8a  Letra sincronizada + pontuacao por microfone (fork)          <-- já está no GitHub
```

Por isso o envio é um `push` normal (fast-forward). **Não** rode `git init`,
`git remote set-url` para outro endereço nem `git push --force`: qualquer um dos três
atrapalha (recriar o histórico faz o GitHub recusar por `non-fast-forward`).

## Opção 1 — script (mais fácil)

```bash
cd karaokeando-repo-v2
bash publicar.sh
```

Ele confere o remote, mostra os commits que vão subir, trava se algum arquivo indevido
(node_modules, .env, dist) tiver entrado no commit e então faz o push. Vai pedir
usuário e senha: no GitHub a **senha é um Personal Access Token** clássico com escopo
`repo` (Settings → Developer settings → Personal access tokens → Tokens (classic)).

## Opção 2 — na mão (3 comandos)

```bash
cd karaokeando-repo-v2
git push origin main        # o remote já está configurado, a branch já é main
```

Se pedir credenciais, use o token no lugar da senha. Se aparecer
`non-fast-forward`, **não use `--force`**: rode `git pull --rebase origin main` e
tente de novo.

## Opção 3 — sem terminal (pelo site do GitHub)

1. Baixe esta pasta para o computador.
2. No GitHub, entre em `karaoke-da-casa` → **Add file** → **Upload files**.
3. Arraste as pastas `backend`, `frontend`, `tools` e os arquivos da raiz
   (`README.md`, `MELHORIAS.md`, `catalogo-bonito.json.gz`, `publicar.sh`, …).
4. Commit em `main`. O GitHub aceita até 100 arquivos por vez — são ~80 arquivos, dá em
   uma rodada (o limite de 100 MB por arquivo não é problema: o maior é o `.gz` de 715 KB).

## Em uma sessão nova, com o GitHub conectado

Você não precisa fazer nada além de pedir. Diga algo como:

> "O projeto está em `/home/user/karaokeando-repo-v2`, com o `.git` já alinhado ao
> repositório drlrfsouto/karaoke-da-casa (1 commit à frente). Faça o push desse commit
> na `main` sem recriar o histórico nem usar --force."

E deixe claro **como** o acesso vai ser feito, porque isso muda o que a sessão consegue
fazer sozinha:

- **Token pessoal** (recomendado): você cola um Personal Access Token (escopo `repo`)
  na conversa. Aí o agente cria o repositório se precisar, faz o push e confere o
  resultado na API do GitHub.
  ⚠️ Trate o token como senha: gere um **token novo, só para isso**, com validade curta
  e escopo mínimo; revogue depois em Settings → Developer settings.
- **Conector oficial do GitHub** (se aparecer na lista de apps conectáveis da sessão):
  ele pede autorização pelo navegador, sem você colar segredo. Nem toda sessão oferece
  esse conector para este workspace — se não aparecer, use o token.

Se quiser, peça também para o agente:
- conferir o resultado (`gh api repos/drlrfsouto/karaoke-da-casa/commits/main`);
- criar uma **tag** de versão;
- abrir um **Pull Request** em vez de commitar direto na `main`.

## O que NÃO vai junto (de propósito)

`node_modules/`, `dist/`, `.env`, `catalogo.json` (8,6 MB, bruto) e `.cache-oembed.json`
(20 MB, cache do enriquecimento). O catálogo final vai **compactado** em
`catalogo-bonito.json.gz` (715 KB) — descompacte antes de importar no app.
