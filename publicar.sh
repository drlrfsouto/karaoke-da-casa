#!/usr/bin/env bash
# Publica o Karaokê da Casa em https://github.com/drlrfsouto/karaoke-da-casa
#
# COMO USAR (o jeito fácil):
#   1. baixe a pasta karaokeando-repo-v2 para o seu computador
#   2. abra o terminal DENTRO dessa pasta
#   3. bash publicar.sh
#
# O git vai pedir usuário e senha. No GitHub a "senha" é um Personal Access Token
# (Settings -> Developer settings -> Personal access tokens -> Tokens (classic),
#  escopo "repo"). Cole o token quando ele pedir a senha.
#
# IMPORTANTE: esta pasta JÁ TEM o histórico do repositório dentro (.git).
# Não rode "git init" aqui. Ela está 1 commit à frente do GitHub, então o envio é
# um "fast-forward" simples e nada do que já está lá é perdido.

set -euo pipefail

REPO="https://github.com/drlrfsouto/karaoke-da-casa.git"
MSG="Catálogo de 24 mil músicas + busca sem acento no servidor"

echo "==> pasta atual: $(pwd)"
if [ ! -d backend ] || [ ! -d frontend ]; then
  echo "ERRO: rode este script de dentro da pasta karaokeando-repo-v2 (tem que ter backend/ e frontend/)."
  exit 1
fi

# 1) identidade do git (só pergunta se ainda não estiver configurada)
if ! git config user.email >/dev/null 2>&1; then
  echo
  read -rp "Seu email do GitHub: " GIT_EMAIL
  read -rp "Seu nome (ex.: Luis Souto): " GIT_NAME
  git config user.email "$GIT_EMAIL"
  git config user.name "$GIT_NAME"
fi

# 2) remote certo (só troca se estiver diferente)
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO"
else
  git remote add origin "$REPO"
fi
echo "==> remote: $(git remote get-url origin)"

# 3) o que vai subir neste envio
git fetch origin main --quiet || true
echo "==> commits que vão subir:"
git log --oneline origin/main..HEAD || true
echo "==> arquivos alterados neste commit: $(git show --name-only --format="" HEAD | wc -l)"

# 4) trava de segurança: nada indevido no commit
if git show --name-only --format="" HEAD | grep -Eq "node_modules|(^|/)\.env$|(^|/)dist/|\.cache-oembed|catalogo\.json$"; then
  echo "ERRO: o último commit tem arquivo que não deveria subir (node_modules/.env/dist)."
  echo "Avise quem gerou o pacote em vez de continuar."
  exit 1
fi

# 5) se sobrou alguma alteração local, entra num commit novo
if [ -n "$(git status --porcelain)" ]; then
  echo "==> há alterações locais; commitando antes do push"
  git add -A
  git commit -m "$MSG" || true
fi

# 6) push
git branch -M main
git push -u origin main

echo
echo "PRONTO: https://github.com/drlrfsouto/karaoke-da-casa"
