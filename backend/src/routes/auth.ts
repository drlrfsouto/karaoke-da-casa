import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import prisma from "../lib/prisma.js";
import {
  hashPassword,
  verifyPassword,
  generateUserToken,
  verifyToken,
  UserTokenPayload,
} from "../lib/auth.js";

// Validation schemas
const registerGuestSchema = z.object({
  name: z.string().min(2, "Nome deve ter pelo menos 2 caracteres"),
  email: z.string().email("Email inválido"),
  phone: z.string().min(10, "Telefone deve ter pelo menos 10 dígitos"),
});

const completeRegistrationSchema = z.object({
  phone: z.string().min(10, "Telefone inválido"),
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  city: z.string().min(2, "Cidade inválida"),
  birthDate: z
    .string()
    .refine((val: string) => !isNaN(Date.parse(val)), "Data inválida"),
  gender: z.enum(["masculino", "feminino", "outro", "prefiro_nao_informar"]),
});

const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Senha é obrigatória"),
});

// Middleware to extract user from token
export async function getUserFromRequest(
  request: FastifyRequest
): Promise<UserTokenPayload | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  const payload = verifyToken(token);

  if (!payload || payload.type !== "user") return null;
  return payload;
}

// Middleware to require authenticated user
export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = await getUserFromRequest(request);
  if (!user) {
    reply
      .code(401)
      .send({ error: "unauthorized", message: "Token inválido ou expirado" });
    return;
  }
  // Attach user to request for later use
  (request as any).user = user;
}

// Middleware to require host (can_host = true)
export async function requireHost(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await requireUser(request, reply);
  if (reply.sent) return;

  const user = (request as any).user as UserTokenPayload;
  if (!user.canHost) {
    reply.code(403).send({
      error: "forbidden",
      message: "Você precisa completar seu cadastro para criar salas",
    });
  }
}

export default async function authRoutes(app: FastifyInstance) {
  // Register as guest (name + email + phone)
  app.post<{ Body: { name: string; email: string; phone: string } }>(
    "/api/auth/register-guest",
    async (request, reply) => {
      const parsed = registerGuestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",
          details: parsed.error.errors,
        });
      }

      const { name, email, phone } = parsed.data;
      const normalizedEmail = email.toLowerCase().trim();

      // Check if user exists
      let user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (user) {
        // User exists - check if they have a password (is a host)
        if (user.passwordHash) {
          // This is a registered host - they need to login with password
          return reply.code(409).send({
            error: "email_registered",
            message: "Este email já está cadastrado. Faça login com sua senha.",
            requiresLogin: true,
          });
        }

        // Guest user exists - update name/phone if different and return token
        if (user.name !== name || user.phone !== phone) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name, phone },
          });
        }
      } else {
        // Create new user
        user = await prisma.user.create({
          data: {
            name,
            email: normalizedEmail,
            phone,
          },
        });
      }

      const token = generateUserToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        canHost: user.canHost,
      });

      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          canHost: user.canHost,
          isComplete: !!user.passwordHash,
        },
      };
    }
  );

  // Register as host (full registration in one step)
  app.post<{
    Body: {
      name: string;
      email: string;
      phone: string;
      password: string;
      city: string;
      birthDate: string;
      gender: string;
    };
  }>("/api/auth/register-host", async (request, reply) => {
    const { name, email, phone, password, city, birthDate, gender } =
      request.body;

    // Validate basic fields
    if (!name || name.length < 2) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Nome deve ter pelo menos 2 caracteres",
      });
    }
    if (!email || !email.includes("@")) {
      return reply
        .code(400)
        .send({ error: "validation_error", message: "Email inválido" });
    }
    if (!phone || phone.length < 10) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Telefone deve ter pelo menos 10 dígitos",
      });
    }
    if (!password || password.length < 6) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Senha deve ter pelo menos 6 caracteres",
      });
    }
    if (!city || city.length < 2) {
      return reply
        .code(400)
        .send({ error: "validation_error", message: "Cidade inválida" });
    }
    if (!birthDate) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Data de nascimento é obrigatória",
      });
    }
    if (!gender) {
      return reply
        .code(400)
        .send({ error: "validation_error", message: "Gênero é obrigatório" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await hashPassword(password);

    // Check if user exists
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      // User exists - check if already a host
      if (user.canHost) {
        return reply.code(400).send({
          error: "already_host",
          message: "Este email já está cadastrado como Host. Faça login.",
        });
      }

      // Update existing user to become host
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          name,
          phone,
          passwordHash,
          city,
          birthDate: new Date(birthDate),
          gender,
          canHost: true,
        },
      });
    } else {
      // Create new user as host
      user = await prisma.user.create({
        data: {
          name,
          email: normalizedEmail,
          phone,
          passwordHash,
          city,
          birthDate: new Date(birthDate),
          gender,
          canHost: true,
        },
      });
    }

    const token = generateUserToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      canHost: true,
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        city: user.city,
        canHost: true,
        isComplete: true,
      },
    };
  });

  // Complete registration (become a host)
  app.post<{
    Body: {
      phone: string;
      password: string;
      city: string;
      birthDate: string;
      gender: string;
    };
  }>("/api/auth/complete-registration", async (request, reply) => {
    const user = await getUserFromRequest(request);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = completeRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        details: parsed.error.errors,
      });
    }

    const { phone, password, city, birthDate, gender } = parsed.data;

    // Check if already complete
    const existingUser = await prisma.user.findUnique({
      where: { id: user.userId },
    });

    if (!existingUser) {
      return reply.code(404).send({ error: "user_not_found" });
    }

    if (existingUser.canHost) {
      return reply.code(400).send({
        error: "already_complete",
        message: "Cadastro já está completo",
      });
    }

    // Update user with complete info
    const passwordHash = await hashPassword(password);
    const updatedUser = await prisma.user.update({
      where: { id: user.userId },
      data: {
        phone,
        passwordHash,
        city,
        birthDate: new Date(birthDate),
        gender,
        canHost: true,
      },
    });

    // Generate new token with updated canHost
    const newToken = generateUserToken({
      userId: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      canHost: true,
    });

    return {
      token: newToken,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        city: updatedUser.city,
        canHost: true,
        isComplete: true,
      },
    };
  });

  // Login (email + password)
  app.post<{ Body: { email: string; password: string } }>(
    "/api/auth/login",
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",
          details: parsed.error.errors,
        });
      }

      const { email, password } = parsed.data;
      const normalizedEmail = email.toLowerCase().trim();

      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (!user) {
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "Email ou senha inválidos",
        });
      }

      if (!user.passwordHash) {
        return reply.code(401).send({
          error: "no_password",
          message: "Esta conta não possui senha. Complete o cadastro primeiro.",
        });
      }

      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "Email ou senha inválidos",
        });
      }

      const token = generateUserToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        canHost: user.canHost,
      });

      return {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          city: user.city,
          canHost: user.canHost,
          isComplete: !!user.passwordHash,
        },
      };
    }
  );

  // Get current user
  app.get("/api/auth/me", async (request, reply) => {
    const userPayload = await getUserFromRequest(request);
    if (!userPayload) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userPayload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        birthDate: true,
        gender: true,
        canHost: true,
        passwordHash: true,
        createdAt: true,
      },
    });

    if (!user) {
      return reply.code(404).send({ error: "user_not_found" });
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        city: user.city,
        birthDate: user.birthDate,
        gender: user.gender,
        canHost: user.canHost,
        isComplete: !!user.passwordHash,
        createdAt: user.createdAt,
      },
    };
  });
}
