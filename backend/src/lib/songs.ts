import prisma from "./prisma.js";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { normalizaBusca } from "./text.js";

export interface SongInfo {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  playCount: number;
  createdAt: Date;
  lastPlayedAt: Date | null;
}

/**
 * Adiciona música à biblioteca (ou retorna se já existe)
 */
export async function addSongToLibrary(
  videoId: string,
  title: string,
  addedBy: string
): Promise<SongInfo> {
  // Upsert: cria se não existe, retorna se existe
  const song = await prisma.song.upsert({
    where: { videoId },
    update: {}, // Não atualiza nada se já existe
    create: {
      videoId,
      title,
      addedBy,
      playCount: 0,
    },
  });

  return song;
}

/**
 * Incrementa o contador de plays quando música termina
 */
export async function incrementPlayCount(videoId: string): Promise<void> {
  await prisma.song.update({
    where: { videoId },
    data: {
      playCount: { increment: 1 },
      lastPlayedAt: new Date(),
    },
  });
}

/**
 * Retorna toda a biblioteca de músicas
 */
export async function getSongLibrary(): Promise<SongInfo[]> {
  return prisma.song.findMany({
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Retorna as músicas mais tocadas
 */
export async function getTopSongs(limit: number = 20): Promise<SongInfo[]> {
  return prisma.song.findMany({
    where: { playCount: { gt: 0 } },
    orderBy: { playCount: "desc" },
    take: limit,
  });
}

/**
 * Remove música da biblioteca
 */
export async function removeSongFromLibrary(videoId: string): Promise<boolean> {
  try {
    await prisma.song.delete({
      where: { videoId },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Busca música por videoId
 */
export async function findSongByVideoId(
  videoId: string
): Promise<SongInfo | null> {
  return prisma.song.findUnique({
    where: { videoId },
  });
}

/**
 * Preenche a coluna de busca (search_key) das músicas que ainda estão sem ela.
 * Acontece na subida do servidor: quem já tinha biblioteca não precisa
 * reimportar nada para a busca passar a ignorar acentos.
 */
export async function backfillSearchKeys(lote = 1000): Promise<number> {
  let total = 0;
  for (let rodada = 0; rodada < 200; rodada++) {
    const pendentes = await prisma.song.findMany({
      where: { searchKey: "" },
      select: { id: true, title: true },
      take: lote,
    });
    if (pendentes.length === 0) break;
    // updateMany por valor: agrupa os títulos iguais para gastar menos queries
    const porChave = new Map<string, string[]>();
    for (const p of pendentes) {
      const chave = normalizaBusca(p.title);
      porChave.set(chave, [...(porChave.get(chave) ?? []), p.id]);
    }
    for (const [chave, ids] of porChave) {
      await prisma.song.updateMany({
        where: { id: { in: ids } },
        data: { searchKey: chave },
      });
    }
    total += pendentes.length;
  }
  return total;
}

/**
 * Atualiza o título (e a chave de busca) das músicas que já existem, sem tocar
 * em playCount/lastPlayedAt. Serve para reimportar um catálogo reenriquecido:
 * "Saudade ESTRANHA - Murilo Huff" vira "Murilo Huff — Saudade Estranha" no
 * lugar, sem duplicar e sem perder o histórico de quem já cantou.
 *
 * Um INSERT ... ON CONFLICT só toca nas linhas cujo título mudou, em lotes.
 */
export async function upsertCatalogoRenomeando(
  linhas: { videoId: string; title: string; searchKey: string; addedBy: string }[]
): Promise<number> {
  let alteradas = 0;
  for (let i = 0; i < linhas.length; i += 1000) {
    const lote = linhas.slice(i, i + 1000);
    const valores = Prisma.join(
      lote.map(
        l =>
          Prisma.sql`(${randomUUID()}, ${l.videoId}, ${l.title}, ${l.searchKey}, ${l.addedBy})`
      )
    );
    const r = await prisma.$executeRaw`
      INSERT INTO "songs" ("id", "video_id", "title", "search_key", "added_by")
      VALUES ${valores}
      ON CONFLICT ("video_id") DO UPDATE
        SET "title" = EXCLUDED."title",
            "search_key" = EXCLUDED."search_key"
        WHERE "songs"."title" <> EXCLUDED."title"
           OR "songs"."search_key" <> EXCLUDED."search_key"
    `;
    alteradas += Number(r) || 0;
  }
  return alteradas;
}
