// Password hashing for the Auth.js credentials provider. Uses bcryptjs (pure
// JS) so it runs on Netlify Functions without a native binary.
import bcrypt from "bcryptjs";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
