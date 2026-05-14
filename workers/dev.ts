process.env.WORKER_KIND ??= "page_scrape,instagram_scrape";

await import("./index.ts");

export {};
