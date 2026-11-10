#!/usr/bin/env python3
"""
Importa o catálogo do TVKaraokê (tvkaraoke.com.br) para o Karaokê da Casa.

O TVKaraokê não hospeda música: ele cataloga vídeos do YouTube que são
karaokê de verdade (curadoria pronta). Este script lê as páginas públicas
(inputs do sitemap) e monta um JSON com {videoId, title, artist, categoria}.

Uso (não precisa de biblioteca nenhuma, só Python 3.9+):

    python3 importar_tvkaraoke.py --limit 200 --out catalogo.json
    python3 importar_tvkaraoke.py --all --workers 12 --out catalogo.json   # ~24 mil

Retomável: tudo que já foi lido fica salvo em <saida>.parcial.jsonl. Se o
script cair, travar a internet ou você fechar o terminal, rode o MESMO
comando de novo e ele continua de onde parou (as músicas já lidas não são
buscadas outra vez).

    python3 importar_tvkaraoke.py --all --retry-falhas   # tenta de novo as que falharam
    python3 importar_tvkaraoke.py --all --reset          # joga o parcial fora e começa do zero

Depois, no app: aba "Músicas" > "Importar catálogo" (aceita esse JSON), e em
seguida o enriquecer_catalogo.py deixa os nomes bonitos ("Artista — Título").

Avisos honestos:
- São 1 requisição por música. Com --workers 12 leva ~40-60 min para 24 mil.
- O catálogo é curadoria de terceiros: use em casa, com bom senso.
- O script é educado: pausa entre lotes e para se o site começar a recusar.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://www.tvkaraoke.com.br"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126 Safari/537.36"
)

# categorias que o site expõe nas páginas de lista
CATEGORIES = {
    "musicas_karaoke_nacionais": "Nacionais",
    "musicas_karaoke_gospel": "Gospel",
    "musicas_karaoke_internacionais": "Internacionais",
    "portuguesas_espanholas_latinas": "Portuguesas/Espanholas",
    "karaoke_japonesas_koreanas_chinesas": "Asiáticas",
}


def fetch(url: str, timeout: int = 25) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "ignore")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return None


def category_from_url(url: str) -> str:
    for slug, nome in CATEGORIES.items():
        if f"/{slug}/" in url:
            return nome
    return "TVKaraokê"


def sitemap_urls(max_index: int = 12) -> list[str]:
    """Lê os sitemaps de vídeo e devolve as URLs de música."""
    urls: list[str] = []
    for i in range(1, max_index + 1):
        xml = fetch(f"{BASE}/uploads/video-sitemap-{i}.xml")
        if not xml:
            break
        found = re.findall(r"<loc>([^<]+)</loc>", xml)
        urls.extend(found)
        print(f"  sitemap-{i}: {len(found)} URLs", file=sys.stderr)
        if len(found) < 1000:
            break
    return urls


def title_from_url(url: str) -> str:
    """'ana-castela-minha-heranca_1caedc249.html' -> 'Ana Castela Minha Herança'."""
    slug = url.rsplit("/", 1)[-1].rsplit("_", 1)[0]
    return " ".join(w.capitalize() for w in slug.replace("-", " ").split())


ID_RE = re.compile(r"watch\?v=([A-Za-z0-9_-]{11})")
TITLE_RE = re.compile(r"\"title\":\s*'([^']{2,140})'")


def scrape_song(url: str) -> dict | None:
    """Abre a página da música e extrai videoId + título real."""
    html = fetch(url)
    if not html:
        return None
    m = ID_RE.search(html)
    if not m:
        # páginas sem player (rascunho/privada)
        return None
    video_id = m.group(1)
    t = TITLE_RE.search(html)
    title = t.group(1).strip() if t else title_from_url(url)
    return {
        "videoId": video_id,
        "title": title,
        "url": url,
        "categoria": category_from_url(url),
    }


def split_artist(title: str) -> tuple[str, str]:
    """'Ana Castela Minha Herança' -> ('Ana Castela', 'Minha Herança') é chute;
    só separamos quando há ' - ' explícito."""
    if " - " in title:
        a, b = title.split(" - ", 1)
        return a.strip(), b.strip()
    return "", title.strip()


def carrega_parcial(path: str, retry_falhas: bool) -> tuple[dict[str, dict], int, set[str]]:
    """Devolve (videoId -> musica, quantos ja estavam no parcial, urls ja lidas)."""
    vistos: dict[str, dict] = {}
    lidas: set[str] = set()
    if not os.path.exists(path):
        return vistos, 0, lidas
    ruins: set[str] = set()
    with open(path, encoding="utf-8") as f:
        for linha in f:
            linha = linha.strip()
            if not linha:
                continue
            try:
                item = json.loads(linha)
            except json.JSONDecodeError:
                continue  # linha truncada por queda no meio da escrita
            if item.get("videoId"):
                vistos.setdefault(item["videoId"], item)
                if item.get("url"):
                    lidas.add(item["url"])
            elif not retry_falhas:
                ruins.add(item.get("url", ""))
    return vistos, len(vistos), (lidas | ruins)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=200, help="quantas músicas (padrão 200)")
    ap.add_argument("--all", action="store_true", help="todas (~24 mil)")
    ap.add_argument("--workers", type=int, default=8, help="requisições paralelas (padrão 8)")
    ap.add_argument("--out", default="catalogo.json", help="arquivo de saída")
    ap.add_argument(
        "--cache",
        default="",
        help="arquivo de progresso (padrão: <saida>.parcial.jsonl)",
    )
    ap.add_argument("--retry-falhas", action="store_true", help="tentar de novo as páginas que falharam")
    ap.add_argument("--reset", action="store_true", help="apagar o progresso salvo e começar do zero")
    args = ap.parse_args()

    cache = args.cache or (os.path.splitext(args.out)[0] + ".parcial.jsonl")
    if args.reset and os.path.exists(cache):
        os.remove(cache)
        print(f"Progresso anterior apagado ({cache}).", file=sys.stderr)

    vistos: dict[str, dict] = {}
    lidas: set[str] = set()
    if os.path.exists(cache):
        vistos, n, lidas = carrega_parcial(cache, args.retry_falhas)
        if n:
            print(f"Retomando: {n} músicas já estavam no parcial ({cache}).", file=sys.stderr)

    print("Lendo sitemaps…", file=sys.stderr)
    urls = sitemap_urls()
    if not urls:
        print("Não consegui ler o sitemap. O site mudou de estrutura?", file=sys.stderr)
        return 1

    total_lista = len(urls) if args.all else min(args.limit, len(urls))
    na_lista = urls[:total_lista]
    # ja temos o videoId? então nem abrimos a página de novo
    ja_ids = set(vistos.keys())
    alvo = [u for u in na_lista if u not in lidas]
    print(
        f"{len(urls)} músicas no catálogo; {total_lista} nesta rodada, "
        f"{len(vistos)} já salvas, {len(alvo)} a buscar.",
        file=sys.stderr,
    )

    t0 = time.time()
    falhas = 0
    novos = 0
    vistos_ids = set(ja_ids)
    parar = False

    with open(cache, "a", encoding="utf-8") as out_cache:
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = {pool.submit(scrape_song, u): u for u in alvo}
            for i, fut in enumerate(as_completed(futures), 1):
                url = futures[fut]
                try:
                    item = fut.result()
                except Exception:
                    item = None
                if item and item["videoId"] not in vistos_ids:
                    vistos_ids.add(item["videoId"])
                    artista, titulo = split_artist(item["title"])
                    musica = {
                        "videoId": item["videoId"],
                        "url": item["url"],
                        "title": item["title"],
                        "artist": artista,
                        "categoria": item.get("categoria", "TVKaraokê"),
                        "fonte": "tvkaraoke.com.br",
                    }
                    vistos[item["videoId"]] = musica
                    out_cache.write(json.dumps(musica, ensure_ascii=False) + "\n")
                    novos += 1
                elif not item:
                    falhas += 1
                    out_cache.write(json.dumps({"url": url}, ensure_ascii=False) + "\n")
                if i % 25 == 0:
                    out_cache.flush()
                if i % 250 == 0 or i == len(alvo):
                    vel = i / max(0.1, time.time() - t0)
                    resta = (len(alvo) - i) / vel if vel > 0 else 0
                    print(
                        f"  {i}/{len(alvo)} · novos={novos} falhas={falhas} "
                        f"· {vel:.1f}/s · falta ~{resta/60:.0f} min",
                        file=sys.stderr,
                    )
                    # se o site começar a recusar tudo, é melhor parar do que insistir
                    if i >= 200 and novos == 0 and falhas >= 200:
                        print("  Site recusando as requisições — parando (rode de novo mais tarde).", file=sys.stderr)
                        parar = True
                        break
        if parar:
            for f in futures:
                f.cancel()

    musicas = list(vistos.values())
    payload = {
        "fonte": "tvkaraoke.com.br",
        "gerado_em": time.strftime("%Y-%m-%d"),
        "total": len(musicas),
        "coletadas_nesta_rodada": novos,
        "faltando": len(alvo) - novos - falhas,
        "musicas": musicas,
    }
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(
        f"\nPronto: {len(musicas)} músicas em {args.out} "
        f"(+{novos} agora, {falhas} falhas).",
        file=sys.stderr,
    )
    if payload["faltando"]:
        print(
            f"Ainda faltam {payload['faltando']} desta rodada: rode o mesmo comando de novo.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
