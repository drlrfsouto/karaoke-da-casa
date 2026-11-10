#!/usr/bin/env python3
"""
Deixa o catálogo do TVKaraokê bonito: troca o nome de arquivo pelo título
REAL do vídeo no YouTube, separa artista e título, marca karaokê/playback
e descarta o que não serve.

Duas etapas, ambas sem chave de API:

  1. enriquecer — consulta o oEmbed público do YouTube (0,03 s por vídeo)
     e guarda título, canal e se é karaokê/playback na cache.
  2. gerar — escreve o catálogo final com "Artista — Título".

Uso:

    python3 enriquecer_catalogo.py --in catalogo.json --out catalogo-bonito.json
    python3 enriquecer_catalogo.py --in catalogo.json --limit 500      # amostra
    python3 enriquecer_catalogo.py --in catalogo.json --workers 16     # mais rápido

A cache fica em `.cache-oembed.json` ao lado do arquivo, então rodar de novo
não repete as consultas (24 mil vídeos ≈ 15 min na primeira vez).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36"

# palavras que indicam karaokê de verdade
KARAOKE_RE = re.compile(
    r"\b(karaok[eê]|karaoke\s*version|vers[aã]o\s*karaok[eê]|playback|"
    r"instrumental|pista|sem\s*voz|guia|videok[eê])\b",
    re.I,
)
# lixo que só polui o título
LIXO_RE = re.compile(
    r"\((?:[^)]*?(?:karaok[eê]|playback|instrumental|oficial|official|clipe|"
    r"v[ií]deo|lyric|letra|hd|hq|4k|ao vivo)[^)]*)\)"
    r"|\[[^\]]*?(?:karaok[eê]|playback|official|hd|4k)[^\]]*\]",
    re.I,
)

# canais que são "karaokê" e não o artista ("Sertanejo Na Karaoke" é canal)
CANAL_KARAOKE = re.compile(r"karaok", re.I)

# prefixos de canal que não são o artista
CANAL_LIXO = re.compile(
    r"^(tv\s*karaok[eê].*|karaok[eê].*|.*karaok[eê].*|.*playback.*|"
    r".*karaoke.*|.*sing\s*king.*|.*party\s*tyme.*)$",
    re.I,
)


# O YouTube recebeu muitos títulos sem acento (o TVKaraokê digita os nomes de
# arquivo sem acentuação). Corrigimos as palavras mais comuns de títulos
# brasileiros + conectivos. Não é um corretor ortográfico: é uma lista curada.
ACENTOS = {
    # conectivos e monossílabos
    "e": "e", "a": "a", "o": "o", "de": "de", "da": "da", "do": "do",
    "na": "na", "no": "no", "em": "em", "um": "um", "uma": "uma",
    "voce": "você", "nao": "não", "sim": "sim", "so": "só", "ja": "já",
    "ate": "até", "por": "por", "para": "para", "pra": "pra", "com": "com",
    "meu": "meu", "minha": "minha", "seu": "seu", "sua": "sua",
    "nos": "nós", "vai": "vai",
    "sozinho": "sozinho", "amor": "amor", "coracao": "coração",
    "ilhao": "ilha", "sao": "são", "estou": "estou", "tambem": "também",
    "entao": "então", "porque": "porque", "porquê": "porquê",
    "historia": "história", "saudade": "saudade", "saudades": "saudades",
    "alegria": "alegria", "tristeza": "tristeza", "esperanca": "esperança",
    "alianca": "aliança", "heranca": "herança", "crianca": "criança",
    "danca": "dança", "lembranca": "lembrança", "confianca": "confiança",
    "distancia": "distância", "importancia": "importância",
    "solidao": "solidão", "paixao": "paixão", "iluso": "ilusão",
    "razao": "razão", "coraçoes": "corações", "cancoes": "canções",
    "flores": "flores", "ceu": "céu", "pe": "pé", "mae": "mãe",
    "irmao": "irmão", "irma": "irmã", "avioes": "aviões", "forro": "forró",
    "musica": "música", "musicas": "músicas", "luz": "luz", "paz": "paz",
    "fe": "fé", "voce": "você", "vera": "vera", "verao": "verão",
    "inverno": "inverno", "primavera": "primavera", "outono": "outono",
    "noite": "noite", "dia": "dia", "sempre": "sempre", "nunca": "nunca",
    "agora": "agora", "depois": "depois", "antes": "antes", "melhor": "melhor",
    "pior": "pior", "saudade": "saudade", "vida": "vida", "morte": "morte",
}

# nomes próprios e artistas que quase sempre estão sem acento no catálogo
ARTISTAS = {
    "avioes do forro": "Aviões do Forró",
    "calcinha preta": "Calcinha Preta",
    "ze neto e cristiano": "Zé Neto e Cristiano",
    "jorge e mateus": "Jorge e Mateus",
    "henrique e juliano": "Henrique e Juliano",
    "chitaozinho e xororo": "Chitãozinho e Xororó",
    "chitaozinho & xororo": "Chitãozinho & Xororó",
    "legiao urbana": "Legião Urbana",
    "gonzaguinha": "Gonzaguinha",
    "luiz gonzaga": "Luiz Gonzaga",
    "milicia": "Milícia",
    "anitta": "Anitta",
    "isadora pompeo": "Isadora Pompeo",
    "aline barros": "Aline Barros",
    "edson gomes": "Edson Gomes",
    "bruno e marrone": "Bruno e Marrone",
    "bruno e denner": "Bruno e Denner",
    "gusttavo lima": "Gusttavo Lima",
    "luan santana": "Luan Santana",
    "marilia mendonca": "Marília Mendonça",
    "maiara e maraisa": "Maiara e Maraísa",
    "ana castela": "Ana Castela",
    "zeze di camargo e luciano": "Zezé di Camargo e Luciano",
    "leandro e leonardo": "Leandro e Leonardo",
    "rick e renner": "Rick e Renner",
    "chico rei": "Chico Rei",
    "raça negra": "Raça Negra",
    "raca negra": "Raça Negra",
    "exaltasamba": "Exaltasamba",
    "thiaguinho": "Thiaguinho",
    "ferrugem": "Ferrugem",
    "pixote": "Pixote",
    "art popular": "Art Popular",
    "so pra contrariar": "Só Pra Contrariar",
    "soweto": "Soweto",
    "katinguele": "Katinguelê",
    "neguinho da beija flor": "Neguinho da Beija-Flor",
    "alcione": "Alcione",
    "beth carvalho": "Beth Carvalho",
    "clara nunes": "Clara Nunes",
    "cartola": "Cartola",
    "nelson cavaquinho": "Nelson Cavaquinho",
    "paula fernandes": "Paula Fernandes",
    "victor e leo": "Victor e Léo",
    "matheus e kauan": "Matheus e Kauan",
    "wesley safadao": "Wesley Safadão",
    "a banda mais bonita da cidade": "A Banda Mais Bonita da Cidade",
    "los hermanos": "Los Hermanos",
    "cazuza": "Cazuza",
    "barão vermelho": "Barão Vermelho",
    "barao vermelho": "Barão Vermelho",
    "titãs": "Titãs",
    "tit as": "Titãs",
    "paralamas do sucesso": "Paralamas do Sucesso",
    "os paralamas do sucesso": "Os Paralamas do Sucesso",
    "skank": "Skank",
    "jota quest": "Jota Quest",
    "capital inicial": "Capital Inicial",
    "kid abelha": "Kid Abelha",
    "engenheiros do hawaii": "Engenheiros do Hawaii",
    "ultraje a rigor": "Ultraje a Rigor",
    "grupo molejo": "Grupo Molejo",
    "molejo": "Molejo",
    "so pra contrariar (grupo)": "Só Pra Contrariar",
    "ze ramalho": "Zé Ramalho",
    "alceu valenca": "Alceu Valença",
    "elba ramalho": "Elba Ramalho",
    "dominguinhos": "Dominguinhos",
    "jackson do pandeiro": "Jackson do Pandeiro",
    "genival lacerda": "Genival Lacerda",
    "claudia leitte": "Cláudia Leitte",
    "ivete sangalo": "Ivete Sangalo",
    "daniela mercury": "Daniela Mercury",
    "carlinhos brown": "Carlinhos Brown",
    "chiclete com banana": "Chiclete com Banana",
    "asa de aguia": "Asa de Águia",
    "timbalada": "Timbalada",
    "olodum": "Olodum",
    "araxa": "Ara Ketu",
    "banda eva": "Banda Eva",
    "netinho": "Netinho",
    "babado novo": "Babado Novo",
    "cheiro de amor": "Cheiro de Amor",
    "harmonia do samba": "Harmonia do Samba",
    "psirico": "Psirico",
    "leo santana": "Léo Santana",
    "claudia leite": "Cláudia Leitte",
    "marcelo d2": "Marcelo D2",
    "criolo": "Criolo",
    "emicida": "Emicida",
    "racionais": "Racionais",
    "racionais mc's": "Racionais MC's",
    "gabriel o pensador": "Gabriel o Pensador",
    "planet hemp": "Planet Hemp",
    "charlie brown jr": "Charlie Brown Jr.",
    "charlie brown junior": "Charlie Brown Jr.",
    "detonautas": "Detonautas",
    "nx zero": "NX Zero",
    "cpms 22": "CPM 22",
    "cpm 22": "CPM 22",
    "fresno": "Fresno",
    "pitty": "Pitty",
    "maria rita": "Maria Rita",
    "marisa monte": "Marisa Monte",
    "gal costa": "Gal Costa",
    "caetano veloso": "Caetano Veloso",
    "gilberto gil": "Gilberto Gil",
    "chico buarque": "Chico Buarque",
    "milton nascimento": "Milton Nascimento",
    "elis regina": "Elis Regina",
    "tom jobim": "Tom Jobim",
    "vinicius de moraes": "Vinicius de Moraes",
    "joao gilberto": "João Gilberto",
    "nara leao": "Nara Leão",
    "djavan": "Djavan",
    "ivan lins": "Ivan Lins",
    "roberto carlos": "Roberto Carlos",
    "erasmo carlos": "Erasmo Carlos",
    "wando": "Wando",
    "reginaldo rossi": "Reginaldo Rossi",
    "jose augusto": "José Augusto",
    "fagner": "Fagner",
    "belchior": "Belchior",
    "raul seixas": "Raul Seixas",
    "sec os e molhados": "Secos & Molhados",
    "secos e molhados": "Secos & Molhados",
    "novos baianos": "Novos Baianos",
    "mutantes": "Mutantes",
    "os mutantes": "Os Mutantes",
    "tropicalia": "Tropicália",
    "luiz melodia": "Luiz Melodia",
    "jorge ben": "Jorge Ben",
    "jorge ben jor": "Jorge Ben Jor",
    "martinho da vila": "Martinho da Vila",
    "paulinho da viola": "Paulinho da Viola",
    "zeca pagodinho": "Zeca Pagodinho",
    "fundo de quintal": "Fundo de Quintal",
    "almir guineto": "Almir Guineto",
    "arnaldo antunes": "Arlindo Cruz",
    "arlindo cruz": "Arlindo Cruz",
    "grupo sensacao": "Grupo Sensação",
    "sensacao": "Sensação",
    "imaginasamba": "Imaginasamba",
    "turma do pagode": "Turma do Pagode",
    "péricles": "Péricles",
    "pericles": "Péricles",
    "chrigor": "Chrigor",
    "vianna": "Vianna",
    "jeito moleque": "Jeito Moleque",
    "inimigos da hp": "Inimigos da HP",
    "exaltasamba": "Exaltasamba",
    "katinguele": "Katinguelê",
    "soweto": "Soweto",
    "os morenos": "Os Morenos",
    "raça negra": "Raça Negra",
    "negritude junior": "Negritude Junior",
    "só pra contrariar": "Só Pra Contrariar",
}

PALAVRAS_TITULO = {
    "ate": "até", "alegria": "alegria", "alegrias": "alegrias",
    "alma": "alma", "almas": "almas", "amor": "amor", "amores": "amores",
    "anjo": "anjo", "anjos": "anjos", "agua": "água", "aguas": "águas",
    "arvore": "árvore", "avioes": "aviões", "bahia": "Bahia",
    "beijo": "beijo", "beijos": "beijos",
    "bem": "bem", "bobagem": "bobagem", "cabeca": "cabeça",
    "caminho": "caminho", "caminhos": "caminhos", "cancao": "canção",
    "cancoes": "canções", "casa": "casa", "causa": "causa",
    "ceu": "céu", "chao": "chão", "chuva": "chuva", "cidade": "cidade",
    "coisa": "coisa", "coisas": "coisas", "coracao": "coração",
    "coracoes": "corações", "crianca": "criança", "criancas": "crianças",
    "danca": "dança", "dancar": "dançar", "dedos": "dedos",
    "deus": "Deus", "dinheiro": "dinheiro", "doce": "doce",
    "dor": "dor", "dores": "dores", "duas": "duas", "dois": "dois",
    "encontro": "encontro", "esperanca": "esperança", "estrada": "estrada",
    "estrela": "estrela", "estrelas": "estrelas", "eternamente": "eternamente",
    "fe": "fé", "felicidade": "felicidade", "ferida": "ferida",
    "festa": "festa", "fim": "fim", "flor": "flor", "flores": "flores",
    "fogo": "fogo", "folia": "folia", "fome": "fome", "forca": "força",
    "frio": "frio", "futuro": "futuro", "garota": "garota",
    "gente": "gente", "guerra": "guerra", "historia": "história",
    "homem": "homem", "hoje": "hoje", "ilha": "ilha", "inocente": "inocente",
    "irma": "irmã", "irmao": "irmão", "janeiro": "janeiro", "jesus": "Jesus",
    "jeito": "jeito", "jogo": "jogo", "jornada": "jornada",
    "lagrima": "lágrima", "lagrimas": "lágrimas", "lembranca": "lembrança",
    "lembrancas": "lembranças", "liberdade": "liberdade", "livre": "livre",
    "louco": "louco", "loucura": "loucura", "lua": "lua", "lugar": "lugar",
    "luz": "luz", "mae": "mãe", "magia": "magia", "maior": "maior",
    "manha": "manhã", "mar": "mar", "margem": "margem", "menina": "menina",
    "menino": "menino", "mente": "mente", "mesmo": "mesmo", "meu": "meu",
    "milagre": "milagre", "moca": "moça", "moinho": "moinho", "mundo": "mundo",
    "musica": "música", "natureza": "natureza", "ninar": "ninar",
    "noite": "noite", "nome": "nome", "nos": "nós", "novo": "novo",
    "olhar": "olhar", "olhos": "olhos", "onda": "onda", "ondas": "ondas",
    "orgulho": "orgulho", "ouro": "ouro", "pai": "pai", "pais": "país",
    "paixao": "paixão", "palavra": "palavra", "paz": "paz", "pe": "pé",
    "pedra": "pedra", "pensamento": "pensamento", "pequena": "pequena",
    "perdao": "perdão", "perto": "perto", "pobre": "pobre", "poder": "poder",
    "poeira": "poeira", "poesia": "poesia", "ponto": "ponto", "porta": "porta",
    "praia": "praia", "primeiro": "primeiro", "primavera": "primavera",
    "principe": "príncipe", "promessa": "promessa", "quarto": "quarto",
    "que": "que", "quem": "quem", "razao": "razão", "razoes": "razões",
    "regresso": "regresso", "rei": "rei", "remedio": "remédio",
    "rio": "rio", "riso": "riso", "rival": "rival", "rosa": "rosa",
    "rosas": "rosas", "rosto": "rosto", "rua": "rua", "ruas": "ruas",
    "sabado": "sábado", "sabor": "sabor", "saudade": "saudade",
    "saudades": "saudades", "segredo": "segredo", "semana": "semana",
    "sempre": "sempre", "senhor": "senhor", "sera": "será", "silencio": "silêncio",
    "sol": "sol", "solidao": "solidão", "sonho": "sonho", "sonhos": "sonhos",
    "sorte": "sorte", "sorriso": "sorriso", "sotaque": "sotaque",
    "suor": "suor", "tarde": "tarde", "teatro": "teatro", "tempo": "tempo",
    "tentacao": "tentação", "terra": "terra", "torto": "torto",
    "trabalho": "trabalho", "traicao": "traição", "trem": "trem",
    "tristeza": "tristeza", "ultimo": "último", "uniao": "união",
    "unico": "único", "universo": "universo", "vazio": "vazio",
    "veia": "veia", "velho": "velho", "verao": "verão", "verdade": "verdade",
    "vez": "vez", "vezes": "vezes", "viagem": "viagem", "vida": "vida",
    "vinganca": "vingança", "violao": "violão", "vingador": "vingador",
    "voce": "você", "vontade": "vontade", "zona": "zona",
}


def acentua_texto(t: str) -> str:
    """Devolve o texto com acentuação corrigida nas palavras conhecidas."""
    def troca(m: re.Match) -> str:
        w = m.group(0)
        low = w.lower()
        novo = PALAVRAS_TITULO.get(low) or ACENTOS.get(low)
        if not novo:
            return w
        # respeita maiúscula inicial
        return novo[0].upper() + novo[1:] if w[0].isupper() else novo

    return re.sub(r"[A-Za-zÀ-ÿ]+", troca, t)


CONECTIVOS = {
    "o", "a", "os", "as", "e", "de", "da", "do", "das", "dos",
    "na", "no", "nas", "nos", "em", "com", "por", "pra", "para",
    "que", "se", "ao", "à", "um", "uma", "mas", "ou",
}


def ajusta_conectivos(t: str) -> str:
    """'Até O Amanhecer' -> 'Até o Amanhecer' (padrão de título em português)."""
    palavras = t.split()
    for i, w in enumerate(palavras):
        if i == 0:
            continue
        if w.lower() in CONECTIVOS:
            palavras[i] = w.lower()
    return " ".join(palavras)


def normaliza_caixa(t: str) -> str:
    """
    Títulos de canal costumam gritar: "BAD BUNNY ft MORA — UNA Vez".
    Se quase tudo está em maiúscula, convertemos para caixa de título.
    """
    letras = [c for c in t if c.isalpha()]
    if len(letras) >= 6 and sum(1 for c in letras if c.isupper()) / len(letras) > 0.7:
        palavras = t.split()
        novas = []
        for i, w in enumerate(palavras):
            lw = w.lower()
            if i > 0 and lw in CONECTIVOS:
                novas.append(lw)
            elif lw in {"ft", "feat", "x"}:
                novas.append(lw)
            else:
                novas.append(w[:1].upper() + w[1:].lower())
        t = " ".join(novas)
    # convenções de participação
    t = re.sub(r"\bFt\b", "ft", t)
    t = re.sub(r"\bFeat\b", "feat", t)
    return t


def acentua_artista(a: str) -> str:
    chave = normaliza_espacos(a).lower()
    return ARTISTAS.get(chave, acentua_texto(a))


def normaliza_espacos(t: str) -> str:
    return re.sub(r"\s{2,}", " ", t).strip(" -–—|")


def oembed(video_id: str, timeout: int = 10):
    """Título e canal reais do vídeo (sem chave de API)."""
    alvo = urllib.parse.quote(f"https://www.youtube.com/watch?v={video_id}", safe="")
    url = f"https://www.youtube.com/oembed?url={alvo}&format=json"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError):
        return None


def separa_artista_titulo(bruto: str) -> tuple[str, str]:
    """
    O título do YouTube vem em três formatos comuns:

      "Anitta   Capa De Revista"           (dois espaços OU mais)
      "Chitãozinho & Xororó - Evidências"  (hífen com espaços)
      "Evidências - Chitãozinho e Xororó"  (título primeiro)

    Devolve (artista, titulo). Quando não dá para decidir, devolve ("", bruto).
    """
    # 0) tira pedaços que são só sujeira ("...   Artista   Titulo   LETRA")
    JUNK = re.compile(r"(?i)^(letra|lyrics?|isrc\s*[:\-]?\s*\w+|karaok[eê]|playback|hd|4k)$")
    pedacos = [p.strip() for p in re.split(r"\s{2,}", bruto.strip()) if p.strip()]
    while len(pedacos) > 1 and JUNK.match(pedacos[-1]):
        pedacos.pop()
    if not pedacos:
        return "", ""

    # 1) separador de dois ou mais espaços — testar ANTES de normalizar
    partes = pedacos
    if len(partes) == 2:
        return normaliza_espacos(partes[0]), normaliza_espacos(partes[1])
    if len(partes) > 2:
        # ex.: "Artista   Feat   Titulo" -> junta o miolo no artista
        return normaliza_espacos(" ".join(partes[:-1])), normaliza_espacos(partes[-1])

    t = normaliza_espacos(bruto)

    # 2) hífen com espaços
    m = re.match(r"^(.{2,60}?)\s+[-–—]\s+(.{2,90})$", t)
    if m:
        a, b = m.group(1).strip(), m.group(2).strip()
        # a parte com cara de artista é a que tem "&", "e", "feat" ou 3+ palavras
        def cara_de_artista(x: str) -> int:
            n = 0
            if re.search(r"\b(&|e|feat|ft|part)\b", x, re.I):
                n += 2
            if re.search(r"\b(banda|dupla|trio|grupo|mc|dj)\b", x, re.I):
                n += 1
            if len(x.split()) >= 3:
                n += 1
            return n

        return (b, a) if cara_de_artista(b) > cara_de_artista(a) else (a, b)

    return "", t


EMOJI_RE = re.compile(
    "[" "\U0001F300-\U0001FAFF" "\U00002600-\U000027BF" "\U0001F900-\U0001F9FF"
    "\U0001F600-\U0001F64F" "\U0001F680-\U0001F6C5" "\u2600-\u26FF" "\uFE0F" "]",
    flags=re.UNICODE,
)


# marcas de direção/formatação que o YouTube deixa no título ("‪MuriloHuff‬")
INVISIVEIS_RE = re.compile(r"[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")


def limpa_invisiveis(t: str) -> str:
    return INVISIVEIS_RE.sub("", t)


# sobras de "letra" e código ISRC que o canal cola no título/artista
LETRA_ISRC_RE = re.compile(
    r"(?i)\s*[-\(\[]?\s*(letra|lyrics?)\b[^)\]-]{0,30}?"
    r"(\(?\s*isrc\s*[:\-]?\s*\w+\)?)?"
)
ISRC_RE = re.compile(r"(?i)\bisrc\s*[:\-]?\s*\w+")


def tira_letra_isrc(t: str) -> str:
    """'Bailar LETRA ISRC: ES54I0325464' -> 'Bailar'."""
    x = LETRA_ISRC_RE.sub(" ", t)
    x = ISRC_RE.sub(" ", x)
    x = re.sub(r"\[[^\]]{0,40}\]", " ", x)
    x = re.sub(r"\(\s*\)", " ", x)   # parênteses vazio
    return re.sub(r"\s+", " ", x).strip(" -–—|:(")


def limpa_artista(a: str) -> str:
    """
    'Chino y Nacho feat Farrruko ( Karaoke)' -> 'Chino y Nacho feat Farrruko'
    'KARAOKE: SEJODIOTO'                     -> 'SEJODIOTO'
    'Justin Quiles (Karaoke EN Casa) 👖'     -> 'Justin Quiles'
    """
    t = EMOJI_RE.sub("", limpa_invisiveis(a))
    # remove parênteses/colchetes com tema karaokê
    t = re.sub(
        r"[\(\[]\s*[^)\]]*?(karaok[eê]|playback|pista|instrumental|en casa|"
        r"version|versi[oó]n|original)[^)\]]*[\)\]]",
        " ",
        t,
        flags=re.I,
    )
    # remove prefixo/sufixo solto
    t = re.sub(r"^\s*(karaok[eê]\s*[:\-–]?\s*)", "", t, flags=re.I)
    t = re.sub(r"\s*[-–—:]*\s*karaok[eê]\s*$", "", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip(" -–—|:")
    # "(Daddy Yankee)" -> "Daddy Yankee"
    m = re.fullmatch(r"\(([^)]{2,60})\)", t)
    if m:
        t = m.group(1).strip()
    return tira_letra_isrc(t)


def limpa_titulo_forte(t: str) -> str:
    """Mesma faxina do artista, aplicada ao título."""
    x = EMOJI_RE.sub("", limpa_invisiveis(t))
    x = re.sub(
        r"[\(\[]\s*[^)\]]*?(karaok[eê]|playback|pista|instrumental|en casa|"
        r"version|versi[oó]n|original|lyrics?|letra|official|oficial|v[ií]deo|"
        r"clipe|ao vivo|hd|hq|4k)[^)\]]*[\)\]]",
        " ",
        x,
        flags=re.I,
    )
    x = re.sub(r"^\s*(karaok[eê]\s*[:\-–]?\s*)", "", x, flags=re.I)
    x = re.sub(r"\s*[-–—:]*\s*karaok[eê]\s*$", "", x, flags=re.I)
    return re.sub(r"\s+", " ", x).strip(" -–—|:")


SO_JUNK_RE = re.compile(
    r"(?i)^\s*(letra|lyrics?|karaok[eê].*|playback|instrumental|hd|hq|4k|"
    r"isrc\s*[:\-]?\s*\w+)\s*$"
)


def cara_de_artista_score(x: str) -> int:
    """Chute de qual lado do hífen é o artista (o mesmo usado na separação)."""
    n = 0
    if re.search(r"\b(&|e|feat|ft|part)\b", x, re.I):
        n += 2
    if re.search(r"\b(banda|dupla|trio|grupo|mc|dj)\b", x, re.I):
        n += 1
    if len(x.split()) >= 3:
        n += 1
    return n


def reorganiza(artista: str, titulo: str) -> tuple[str, str]:
    """Conserta os casos em que a ordem veio trocada ou sobrou só sujeira:

      ("Por Ella - David Bustamante", "LETRA")  -> ("David Bustamante", "Por Ella")
      ("", "Calentura- Yandel")                 -> ("Yandel", "Calentura")
    """
    # sobrou só sujeira no título: o par artista/título está no campo do artista
    if SO_JUNK_RE.match(titulo or "") and "-" in (artista or ""):
        a, t = separa_artista_titulo(artista)
        if t and not SO_JUNK_RE.match(t):
            return a.strip(" -–—|:"), t.strip(" -–—|:")
        return "", artista.strip(" -–—|:")

    # sem artista e o título tem cara de "Titulo- Artista" (hífen sem espaço também)
    if not (artista or "").strip() and re.search(r"\S\s*[-–]\s*\S", titulo or ""):
        a, t = separa_artista_titulo(titulo)
        if not a:
            m = re.match(r"^(.{2,60}?)\s*[-–]\s+(.{2,90})$", titulo.strip()) or re.match(
                r"^(.{2,60}?)\s*[-–]\s*(.{2,90})$", titulo.strip()
            )
            if m:
                a, t = m.group(1).strip(), m.group(2).strip()
        if a and t and cara_de_artista_score(a) >= cara_de_artista_score(t):
            return a, t

    return artista, titulo


def e_karaoke(title: str, author: str) -> bool:
    # no título exigimos palavra inteira; no canal basta conter "karaok"
    # ("TVKaraoke Brasil", "KaraokeBrasil" não têm fronteira de palavra)
    return bool(
        KARAOKE_RE.search(title)
        or re.search(r"karaok|playback|pista|instrumental", author, re.I)
    )


def limpa_titulo(title: str) -> str:
    t = LIXO_RE.sub(" ", title)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip(" -–—|")


def le_entrada(caminho: str) -> list[dict]:
    """Aceita o catalogo.json ({"musicas": [...]}), uma lista solta ou o
    catalogo.parcial.jsonl que a coleta vai gravando — assim dá para
    enriquecer sem esperar a coleta terminar."""
    if caminho.endswith(".jsonl"):
        musicas: list[dict] = []
        vistos: set[str] = set()
        with open(caminho, encoding="utf-8") as f:
            for linha in f:
                linha = linha.strip()
                if not linha:
                    continue
                try:
                    item = json.loads(linha)
                except ValueError:
                    continue  # linha truncada: a coleta ainda estava escrevendo
                vid = item.get("videoId")
                if vid and vid not in vistos:
                    vistos.add(vid)
                    musicas.append(item)
        return musicas
    dados = json.load(open(caminho, encoding="utf-8"))
    return dados.get("musicas", dados if isinstance(dados, list) else [])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--in", dest="entrada", default="catalogo.json")
    ap.add_argument("--out", dest="saida", default="catalogo-bonito.json")
    ap.add_argument("--limit", type=int, default=0, help="processa só N (amostra)")
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--descartar-nao-karaoke", action="store_true",
                    help="remove vídeos que não parecem karaokê/playback")
    args = ap.parse_args()

    musicas = le_entrada(args.entrada)
    if args.limit:
        musicas = musicas[: args.limit]
    print(f"{len(musicas)} músicas para enriquecer", file=sys.stderr)

    cache_path = os.path.join(os.path.dirname(os.path.abspath(args.saida)), ".cache-oembed.json")
    cache: dict[str, dict] = {}
    if os.path.exists(cache_path):
        try:
            cache = json.load(open(cache_path, encoding="utf-8"))
            print(f"cache: {len(cache)} vídeos já consultados", file=sys.stderr)
        except ValueError:
            cache = {}

    faltando = [m for m in musicas if m.get("videoId") and m["videoId"] not in cache]
    t0 = time.time()
    feitos = 0
    if faltando:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futs = {pool.submit(oembed, m["videoId"]): m["videoId"] for m in faltando}
            for fut in as_completed(futs):
                vid = futs[fut]
                try:
                    info = fut.result()
                except Exception:
                    info = None
                cache[vid] = info or {"erro": True}
                feitos += 1
                if feitos % 250 == 0 or feitos == len(faltando):
                    vel = feitos / max(0.1, time.time() - t0)
                    resta = (len(faltando) - feitos) / vel if vel else 0
                    print(
                        f"  {feitos}/{len(faltando)} · {vel:.0f}/s · falta ~{resta/60:.0f} min",
                        file=sys.stderr,
                    )
        json.dump(cache, open(cache_path, "w", encoding="utf-8"), ensure_ascii=False)
        print(f"cache salva em {cache_path}", file=sys.stderr)

    saida = []
    descartados = 0
    sem_info = 0
    for m in musicas:
        vid = m.get("videoId")
        if not vid:
            continue
        info = cache.get(vid) or {}
        if info.get("erro") or not info.get("title"):
            sem_info += 1
            # mantém a versão do TVKaraokê, pelo menos capitalizada
            titulo = m.get("title", "")
            saida.append(
                {
                    "videoId": vid,
                    "title": titulo,
                    "artist": m.get("artist", ""),
                    "karaoke": True,
                    "canal": "",
                    "fonte": m.get("fonte", "tvkaraoke.com.br"),
                }
            )
            continue

        bruto = info["title"]
        canal = info.get("author_name", "") or ""
        artista, titulo = separa_artista_titulo(bruto)
        titulo = limpa_titulo_forte(limpa_titulo(titulo)) or titulo
        titulo = tira_letra_isrc(titulo) or titulo
        artista = limpa_artista(artista)
        artista = normaliza_caixa(ajusta_conectivos(acentua_artista(artista)))
        titulo = normaliza_caixa(ajusta_conectivos(acentua_texto(titulo)))
        # se título e artista ficaram iguais, é sinal de separação ruim
        if artista and artista.lower() == titulo.lower():
            titulo, artista = artista, ""

        # se o "artista" veio vazio ou o título está vazio, cai para o nome do arquivo
        if not titulo:
            titulo = m.get("title", bruto)
        # canal de karaokê (contém "karaok") não é artista: nesse caso tenta o
        # nome do arquivo; se também não der, o vídeo fica só com o título
        # (melhor do que creditar "Sertanejo Na Karaoke" como cantor).
        if CANAL_KARAOKE.search(canal):
            if not artista:
                artista = m.get("artist", "") or ""
            artista = re.sub(r"\s*[-–—|]*\s*(karaok[eê].*)$", "", artista, flags=re.I)
            artista = re.sub(r"(?i)\b(n[ao]\s+)?karaok[eê]\b.*$", "", artista).strip(" -–—|:")
            # canal de karaokê citado no meio do título ("LETRA" é sobra)
            titulo = re.sub(r"\s+(?i:letra)\s*$", "", titulo).strip()

        artista, titulo = reorganiza(artista, titulo)
        artista = artista.strip(" -–—|:")
        titulo = titulo.strip(" -–—|:") or bruto

        k = e_karaoke(bruto, canal)
        if args.descartar_nao_karaoke and not k:
            descartados += 1
            continue

        saida.append(
            {
                "videoId": vid,
                "title": titulo.strip(),
                "artist": artista.strip(),
                "karaoke": k,
                "canal": canal,
                "fonte": m.get("fonte", "tvkaraoke.com.br"),
            }
        )

    payload = {
        "fonte": "tvkaraoke.com.br + YouTube oEmbed",
        "gerado_em": time.strftime("%Y-%m-%d"),
        "total": len(saida),
        "sem_metadados": sem_info,
        "descartados": descartados,
        "musicas": saida,
    }
    json.dump(payload, open(args.saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(
        f"\nPronto: {len(saida)} músicas em {args.saida}"
        f" (sem metadados: {sem_info}, descartadas: {descartados})",
        file=sys.stderr,
    )
    print("\nExemplos:", file=sys.stderr)
    for m in saida[:6]:
        nome = f"{m['artist']} — {m['title']}" if m["artist"] else m["title"]
        print(f"  {'♪' if m['karaoke'] else '·'} {nome[:70]}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
