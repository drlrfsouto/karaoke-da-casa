import prisma from "./prisma.js";

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
