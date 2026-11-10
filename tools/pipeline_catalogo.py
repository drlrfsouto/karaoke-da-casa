#!/usr/bin/env python3
"""
Encadeia o pipeline do catálogo, tolerando interrupções:

  1. coleta (tools/importar_tvkaraoke.py --all)  — retomável
  2. enriquecimento (tools/enriquecer_catalogo.py) — usa cache
  3. importa no app (POST /api/songs/import)

Se a coleta cair no meio, o laço roda de novo até o parcial parar de crescer
e o JSON final ficar com as 24 mil músicas (ou 3 tentativas seguidas sem
progresso). Cada etapa grava log ao lado dos arquivos.

Uso:
    python3 tools/pipeline_catalogo.py            # tudo, do zero/retomando
    python3 tools/pipeline_catalogo.py --skip-collect   # só 2 e 3
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA_DIR = os.environ.get("CATALOGO_DIR", "/home/user/catalogo")
BRUTO = os.path.join(SAIDA_DIR, "catalogo.json")
BONITO = os.path.join(SAIDA_DIR, "catalogo-bonito.json")
API = os.environ.get("KARAOKE_API", "http://127.0.0.1:8787")


def parcial() -> str:
    return os.path.splitext(BRUTO)[0] + ".parcial.jsonl"


def contar_parcial() -> int:
    path = parcial()
    if not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as f:
        return sum(1 for linha in f if '"videoId"' in linha)


def roda(cmd: list[str]) -> int:
    print(f"\n$ {' '.join(cmd)}", flush=True)
    return subprocess.call(cmd)


def coleta() -> None:
    sem_progresso = 0
    anterior = -1
    for tentativa in range(1, 9):
        antes = contar_parcial()
        print(f"\n=== coleta · tentativa {tentativa} · {antes} músicas no parcial ===", flush=True)
        roda(
            [
                sys.executable,
                os.path.join(AQUI, "importar_tvkaraoke.py"),
                "--all",
                "--workers",
                "12",
                "--out",
                BRUTO,
            ]
        )
        depois = contar_parcial()
        print(f"=== coleta: +{depois - antes} (total {depois}) ===", flush=True)
        if depois >= 24000:
            return
        if depois <= antes:
            sem_progresso += 1
            if sem_progresso >= 3:
                print("=== coleta parou de avançar 3 vezes; seguindo com o que temos ===", flush=True)
                return
        else:
            sem_progresso = 0
        if depois == anterior:
            return
        anterior = depois
        time.sleep(5)


def enriquece() -> None:
    roda(
        [
            sys.executable,
            os.path.join(AQUI, "enriquecer_catalogo.py"),
            "--in",
            BRUTO,
            "--out",
            BONITO,
            "--workers",
            "16",
        ]
    )


def importa() -> None:
    if not os.path.exists(BONITO):
        print("!! catálogo enriquecido não existe; pulando a importação", flush=True)
        return
    with open(BONITO, encoding="utf-8") as f:
        dados = json.load(f)
    musicas = dados.get("musicas", dados if isinstance(dados, list) else [])
    corpo = json.dumps({"musicas": musicas, "addedBy": "Catálogo"}, ensure_ascii=False).encode()
    req = urllib.request.Request(
        f"{API}/api/songs/import",
        data=corpo,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    print(f"\n=== importando {len(musicas)} músicas no app ===", flush=True)
    with urllib.request.urlopen(req, timeout=300) as r:
        print(r.read().decode(), flush=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-collect", action="store_true")
    ap.add_argument("--skip-import", action="store_true")
    args = ap.parse_args()

    os.makedirs(SAIDA_DIR, exist_ok=True)
    t0 = time.time()
    if not args.skip_collect:
        coleta()
    enriquece()
    if not args.skip_import:
        importa()
    print(f"\n=== pipeline concluído em {(time.time() - t0) / 60:.0f} min ===", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
