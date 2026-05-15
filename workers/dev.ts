process.env.WORKER_KIND ??= "page_scrape,instagram_scrape,auto_draft,send_email";

await import("./index.ts");

export {};
