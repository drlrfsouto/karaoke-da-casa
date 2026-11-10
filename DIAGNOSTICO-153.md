# Erro 153 do YouTube — o que é e o que fazer

## O que o erro diz
Dentro do player aparece "Erro de configuração do player de vídeo / Erro 153".
Isso é uma mensagem **do YouTube**, não do app: desde o fim de 2025 o player
incorporado exige que a página se identifique (cabeçalho HTTP `Referer`).

## O que já foi feito no código
- `<meta name="referrer" content="strict-origin-when-cross-origin">` na página
- `origin` e `widget_referrer` no player
- `referrerpolicy` reforçado no iframe gerado pela API
- alternativa automática entre `youtube.com` e `youtube-nocookie.com`
- vigia de 9 s: se o vídeo não anda, a TV mostra o aviso mesmo quando o erro
  não é reportado pelo player
- botão **"Abrir no YouTube ↗"** sempre visível no aviso

## Diagnóstico rápido pelo sintoma

Se a página de diagnóstico mostrar `Origem: file://`, o resultado **não vale**:
abrir qualquer arquivo com duplo clique faz o navegador não enviar `Referer`, e o
YouTube devolve **153 sempre**. Nesse teste, as variantes "SEM parâmetros" dão
153 e as "com origin" ficam em timeout — é a assinatura exata do `file://`.

Abra sempre por `http://localhost:3000/...`.

## O que você precisa fazer (em ordem)

1. **Rodar pelo servidor**, nunca por `file://`
   `http://localhost:3000` — abrir o HTML com duplo clique nunca tem `Referer`.
   Baixar a página de diagnóstico na pasta Downloads e clicar duas vezes é o erro
   mais comum: ela precisa ser aberta pela URL do servidor.

2. **Atualizar o código e limpar cache**
   ```bash
   git pull
   rm -rf frontend/node_modules/.vite
   # reinicie: cd frontend && npm run dev
   ```
   Na TV: **Ctrl+Shift+R** (recarga forçada).

3. **Rodar a página de diagnóstico**
   Com o servidor de pé, abra: `http://localhost:3000/diagnostico-youtube.html`
   Ela testa 5 combinações e diz qual funcionou. Copie o resumo.

4. **Desativar extensões** de privacidade/bloqueio neste site
   (uBlock Origin, Privacy Badger, Ghostery, Brave Shields). Muitas removem o
   cabeçalho `Referer` e causam exatamente o 153.

5. **Testar a origem alternativa**: em vez de `localhost`, use `http://127.0.0.1:3000`.
   Para o YouTube são origens diferentes.

## Se nada funcionar
- Clique em **"Abrir no YouTube ↗"** no aviso da TV: o vídeo abre em outra aba e a
  letra sincronizada + o microfone continuam funcionando na TV.
- Ou escolha outra versão da música no celular: o bloqueio é por vídeo.
- Último recurso: modo MP4 (pacotes baixados) do app antigo `karaoke/index.html`,
  que não depende do YouTube.
