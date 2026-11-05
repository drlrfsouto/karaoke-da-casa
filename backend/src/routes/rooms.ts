import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  hashPassword,
  verifyPassword,
  generateTvToken,
  verifyToken,
  UserTokenPayload,
} from "../lib/auth.js";
import { getUserFromRequest } from "./auth.js";

// Validation schemas
const createRoomSchema = z.object({
  tvPassword: z
    .string()
    .length(6, "Senha do TV deve ter exatamente 6 caracteres"),
});

const tvLoginSchema = z.object({
  tvPassword: z.string().min(1, "Senha é obrigatória"),
});

// Generate room code (5 characters, uppercase alphanumeric)
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars (0, O, 1, I)
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Interface for room state callbacks
export interface RoomCallbacks {
  onRoomCreated?: (roomCode: string, ownerId: string) => void;
}

let callbacks: RoomCallbacks = {};

export function setRoomCallbacks(cb: RoomCallbacks) {
  callbacks = cb;
}

export default async function roomRoutes(app: FastifyInstance) {
  // Create room (requires host)
  app.post<{ Body: { tvPassword: string } }>(
    "/api/rooms",
    async (request, reply) => {
      const user = await getUserFromRequest(request);
      if (!user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      if (!user.canHost) {
        return reply.code(403).send({
          error: "forbidden",
          message: "Você precisa completar seu cadastro para criar salas",
        });
      }

      const parsed = createRoomSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",
          details: parsed.error.errors,
        });
      }

      const { tvPassword } = parsed.data;

      // Generate unique room code
      let code = generateRoomCode();
      let attempts = 0;
      while (attempts < 10) {
        const existing = await prisma.room.findUnique({ where: { code } });
        if (!existing) break;
        code = generateRoomCode();
        attempts++;
      }

      // Hash TV password
      const tvPasswordHash = await hashPassword(tvPassword);

      // Create room in database
      const room = await prisma.room.create({
        data: {
          code,
          ownerId: user.userId,
          tvPasswordHash,
        },
      });

      // Notify server to create in-memory state
      if (callbacks.onRoomCreated) {
        callbacks.onRoomCreated(room.code, room.ownerId);
      }

      return { roomCode: room.code };
    }
  );

  // TV Login (get tvToken with password)
  app.post<{ Params: { roomCode: string }; Body: { tvPassword: string } }>(
    "/api/rooms/:roomCode/tv/login",
    async (request, reply) => {
      const { roomCode } = request.params;

      const parsed = tvLoginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",
          details: parsed.error.errors,
        });
      }

      const { tvPassword } = parsed.data;

      // Find room
      const room = await prisma.room.findUnique({
        where: { code: roomCode.toUpperCase() },
      });

      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }

      // Verify password
      const isValid = await verifyPassword(tvPassword, room.tvPasswordHash);
      if (!isValid) {
        return reply.code(401).send({
          error: "invalid_password",
          message: "Senha incorreta",
        });
      }

      // Generate TV token
      const tvToken = generateTvToken(room.code);

      return { tvToken, roomCode: room.code };
    }
  );

  // Check if room exists (public)
  app.get<{ Params: { roomCode: string } }>(
    "/api/rooms/:roomCode/exists",
    async (request, reply) => {
      const { roomCode } = request.params;

      const room = await prisma.room.findUnique({
        where: { code: roomCode.toUpperCase() },
        select: { code: true, createdAt: true },
      });

      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }

      return { exists: true, roomCode: room.code };
    }
  );

  // Owner access to TV (no password needed)
  app.post<{ Params: { roomCode: string } }>(
    "/api/rooms/:roomCode/tv/owner-access",
    async (request, reply) => {
      const user = await getUserFromRequest(request);
      if (!user) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      const { roomCode } = request.params;

      // Find room
      const room = await prisma.room.findUnique({
        where: { code: roomCode.toUpperCase() },
      });

      if (!room) {
        return reply.code(404).send({ error: "room_not_found" });
      }

      // Check if user is owner
      if (room.ownerId !== user.userId) {
        return reply.code(403).send({
          error: "forbidden",
          message: "Você não é o dono desta sala",
        });
      }

      // Generate TV token
      const tvToken = generateTvToken(room.code);

      return { tvToken, roomCode: room.code };
    }
  );

  // Get rooms owned by current user
  app.get("/api/rooms/my-rooms", async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const rooms = await prisma.room.findMany({
      where: { ownerId: user.userId },
      select: {
        id: true,
        code: true,
        uniqueVisitors: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return { rooms };
  });
}

// In-memory Set to track visitors per room (resets on server restart)
// Format: "ROOMCODE:userId"
const visitedSet = new Set<string>();

// Helper function to record visit (for use in WebSocket handler)
// Uses in-memory Set to avoid duplicates, persists count to DB
export async function recordRoomVisit(
  roomCode: string,
  odUserId: string
): Promise<boolean> {
  const key = `${roomCode.toUpperCase()}:${odUserId}`;

  // Already counted in this server session
  if (visitedSet.has(key)) {
    return false;
  }

  const room = await prisma.room.findUnique({
    where: { code: roomCode.toUpperCase() },
  });

  if (!room) return false;

  // Mark as visited in memory
  visitedSet.add(key);

  // Increment counter in database
  await prisma.room.update({
    where: { id: room.id },
    data: { uniqueVisitors: { increment: 1 } },
  });

  return true;
}

// Clear visits for a room (call when room is deleted or server restarts)
export function clearRoomVisits(roomCode: string) {
  const prefix = `${roomCode.toUpperCase()}:`;
  for (const key of visitedSet) {
    if (key.startsWith(prefix)) {
      visitedSet.delete(key);
    }
  }
}
