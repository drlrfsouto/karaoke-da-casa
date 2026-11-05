import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

// Validate JWT_SECRET in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production!");
}
const SECRET = JWT_SECRET || "dev-secret-change-in-production";

const SALT_ROUNDS = 10;

// Token payload types
export interface UserTokenPayload {
  userId: string;
  email: string;
  name: string;
  canHost: boolean;
  type: "user";
}

export interface TvTokenPayload {
  roomCode: string;
  type: "tv";
}

export type TokenPayload = UserTokenPayload | TvTokenPayload;

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Compare password with hash
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Generate user token (24h expiry)
export function generateUserToken(
  payload: Omit<UserTokenPayload, "type">
): string {
  return jwt.sign({ ...payload, type: "user" }, SECRET, {
    expiresIn: "24h",
  });
}

// Generate TV token (12h expiry)
export function generateTvToken(roomCode: string): string {
  const payload: TvTokenPayload = { roomCode, type: "tv" };
  return jwt.sign(payload, SECRET, { expiresIn: "12h" });
}

// Verify and decode token
export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

// Decode token without verification (for debugging)
export function decodeToken(token: string): TokenPayload | null {
  try {
    return jwt.decode(token) as TokenPayload;
  } catch {
    return null;
  }
}
