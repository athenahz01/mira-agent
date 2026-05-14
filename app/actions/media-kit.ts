"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  mediaKitJsonSchema,
  pastBrandWorkInputSchema,
  type MediaKitJson,
} from "@/lib/db/media-kit";
import type { Tables } from "@/lib/db/types";
import {
  generateAndPersistMediaKit,
  getMediaKit,
  saveMediaKitEdits as saveMediaKitEditsForUser,
  updateMediaKitPdfPath,
  upsertPastBrandWork as upsertPastBrandWorkForUser,
  type MediaKitContext,
} from "@/lib/media-kit/service";
import { renderMediaKitPdfBuffer } from "@/lib/pdf/media-kit-renderer";
import { createClient } from "@/lib/supabase/server";

export type ActionResult<T> =
  | {
      ok: true;
      data: T;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

const profilePastWorkSchema = z.object({
  profileId: z.string().uuid(),
  pastBrandWork: z.array(pastBrandWorkInputSchema),
});

export async function generateMediaKitDraft(
  profileId: string,
  pastBrandWork: z.infer<typeof pastBrandWorkInputSchema>[],
): Promise<ActionResult<Tables<"media_kits">>> {
  return runMediaKitAction("Media kit generated.", async (context) => {
    const parsed = profilePastWorkSchema.parse({
      profileId,
      pastBrandWork,
    });
    return generateAndPersistMediaKit(
      context,
      parsed.profileId,
      parsed.pastBrandWork,
    );
  });
}

export async function saveMediaKitEdits(
  kitId: string,
  edits: MediaKitJson,
): Promise<ActionResult<Tables<"media_kits">>> {
  return runMediaKitAction("Media kit edits saved.", async (context) =>
    saveMediaKitEditsForUser(
      context,
      z.string().uuid().parse(kitId),
      mediaKitJsonSchema.parse(edits),
    ),
  );
}

export async function renderMediaKitPdf(
  kitId: string,
): Promise<ActionResult<{ kit: Tables<"media_kits">; signedUrl: string }>> {
  return runMediaKitAction("Media kit PDF rendered.", async (context) => {
    const { row, json } = await getMediaKit(
      context,
      z.string().uuid().parse(kitId),
    );
    const pdfBuffer = await renderMediaKitPdfBuffer(json);
    const pdfPath = `${context.userId}/${row.id}.pdf`;
    const { error: uploadError } = await context.supabase.storage
      .from("media-kits")
      .upload(pdfPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const updatedKit = await updateMediaKitPdfPath(context, row.id, pdfPath);
    const { data, error } = await context.supabase.storage
      .from("media-kits")
      .createSignedUrl(pdfPath, 60 * 10);

    if (error || !data) {
      throw new Error(error?.message ?? "Could not sign media kit PDF.");
    }

    return {
      kit: updatedKit,
      signedUrl: data.signedUrl,
    };
  });
}

export async function upsertPastBrandWork(
  profileId: string,
  entries: z.infer<typeof pastBrandWorkInputSchema>[],
): Promise<ActionResult<Tables<"past_brand_work">[]>> {
  return runMediaKitAction("Past brand work saved.", async (context) => {
    const parsed = profilePastWorkSchema.parse({
      profileId,
      pastBrandWork: entries,
    });
    return upsertPastBrandWorkForUser(
      context,
      parsed.profileId,
      parsed.pastBrandWork,
    );
  });
}

async function runMediaKitAction<T>(
  message: string,
  callback: (context: MediaKitContext) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const context = await getMediaKitContext();
    const data = await callback(context);
    revalidatePath("/kits");
    revalidatePath("/dashboard");

    return {
      ok: true,
      data,
      message,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Mira could not update that media kit.",
    };
  }
}

async function getMediaKitContext(): Promise<MediaKitContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Please sign in first.");
  }

  return {
    supabase,
    userId: user.id,
    email: user.email ?? "zhengathenahuo@gmail.com",
  };
}
