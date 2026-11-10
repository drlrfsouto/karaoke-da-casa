#!/usr/bin/env bash
# Publica o Karaokê da Casa em https://github.com/drlrfsouto/karaoke-da-casa
#
# Como usar:
#   1. baixe a pasta karaokeando-repo-v2 para o seu computador
#   2. abra o terminal DENTRO dessa pasta
#   3. bash publicar.sh
#
# O git vai pedir usuário e senha. No GitHub a "senha" é um Personal Access Token
# (Settings -> Developer settings -> Personal access tokens -> Tokens (classic),
#  escopo "repo"). Cole o token quando ele pedir a senha.

set -euo pipefail

REPO="https://github.com/drlrfsouto/karaoke-da-casa.git"
MSG="Letra sincronizada + pontuacao por microfone (fork do Karaokeando)"

echo "==> pasta atual: $(pwd)"
if [ ! -d backend ] || [ ! -d frontend ]; then
  echo "ERRO: rode este script de dentro da pasta karaokeando-repo-v2 (tem que ter backend/ e frontend/)."
  exit 1
fi

# 1) garante que nada indevido entre no commit
if [ -d .git ]; then
  echo "==> já existe um .git aqui (nada a fazer no init)"
else
  git init -b main
fi

git add .
echo "==> arquivos que vão subir: $(git diff --cached --name-only | wc -l)"
if git diff --cached --name-only | grep -Eq "node_modules|(^|/)\.env$|(^|/)dist/"; then
  echo "ERRO: algo que não deveria subir foi selecionado. Abortando."
  exit 1
fi

# 2) identidade do git (só pergunta se ainda não estiver configurada)
if ! git config user.email >/dev/null 2>&1; then
  echo
  read -rp "Seu email do GitHub: " GIT_EMAIL
  read -rp "Seu nome (ex.: Luis Souto): " GIT_NAME
  git config user.email "$GIT_EMAIL"
  git config user.name "$GIT_NAME"
fi

# 3) commit
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "==> já existe commit; criando um novo com o que mudou"
fi
git commit -m "$MSG" || echo "(nada novo para commitar)"

# 4) branch + remote
git branch -M main
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO"
else
  git remote add origin "$REPO"
fi
echo "==> remote: $(git remote get-url origin)"

# 5) push
git push -u origin main

echo
echo "PRONTO: https://github.com/drlrfsouto/karaoke-da-casa"
