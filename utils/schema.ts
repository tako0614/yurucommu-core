import { z } from "zod";

export const passwordSchema = z.string().min(8).max(100);

export const userNameSchema = z.string().min(3).max(20).regex(
    /^[a-zA-Z0-9_]+$/,
);

export const userIdSchema = z.string().email();

export const emailSchema = z.string().email();
