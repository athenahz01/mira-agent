process.env.WORKER_KIND ??=
  "page_scrape,instagram_scrape,auto_draft,send_email,inbox_poll,follow_up_generate";

await import("./index.ts");

export {};
