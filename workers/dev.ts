process.env.WORKER_KIND ??= "page_scrape,instagram_scrape,auto_draft";

await import("./index.ts");

export {};
