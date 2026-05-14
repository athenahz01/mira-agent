import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";

import type { MediaKitJson } from "@/lib/db/media-kit";
import { MediaKitDocument } from "@/lib/pdf/media-kit-document";

export async function renderMediaKitPdfBuffer(kit: MediaKitJson) {
  return renderToBuffer(
    React.createElement(MediaKitDocument, {
      kit,
    }) as unknown as React.ReactElement<DocumentProps>,
  );
}
