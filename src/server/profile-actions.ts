"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/rbac";
import type { ActionResult } from "./finance-actions";

/**
 * Self-service profile: any signed-in user may update their own display name and
 * photo. Email (the login identity) and role stay read-only here - those are
 * changed by an Admin in People → Users.
 */

// Photos arrive as a client-resized data URL (see ProfileClient). Keep the cap
// tight: better-auth reads the FULL user row (incl. image) on EVERY getSession,
// and the shell serializes it into every page - a 256px JPEG is ~40-60 KB of
// base64, so 250 KB is generous headroom without letting one avatar tax
// every request in the app.
const MAX_IMAGE_CHARS = 250_000;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),
  image: z
    .string()
    .trim()
    .max(MAX_IMAGE_CHARS, "Image is too large - please choose a smaller photo")
    // Raster data-URLs from the client-side resizer, or an https URL. No http
    // (mixed content) and no svg (scriptable) - this string lands in <img src>.
    .refine(
      (v) =>
        v === "" ||
        /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) ||
        /^https:\/\//.test(v),
      { message: "Invalid image" },
    )
    .optional(),
});

export async function updateMyProfile(form: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const parsed = schema.safeParse({
    name: form.get("name"),
    image: form.get("image") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { name, image } = parsed.data;

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name,
        // "" clears the photo back to initials; undefined leaves it untouched.
        ...(image === undefined ? {} : { image: image === "" ? null : image }),
      },
    });
    // keep a linked team-profile card's name in sync with the account name
    await prisma.teamProfile.updateMany({ where: { userId: session.user.id }, data: { fullName: name } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save profile" };
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout"); // refresh the sidebar name/avatar everywhere
  return { ok: true };
}
