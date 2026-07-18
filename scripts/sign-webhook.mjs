import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";

function getArg(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] || null;
}

async function main() {
  const secret = getArg("--secret");
  const payload = getArg("--payload");
  const file = getArg("--file");

  if (!secret || (!payload && !file)) {
    console.error("Usage: node scripts/sign-webhook.mjs --secret test_webhook_secret --payload '{...}'");
    console.error("   or: node scripts/sign-webhook.mjs --secret test_webhook_secret --file payload.json");
    process.exitCode = 1;
    return;
  }

  const rawBody = file ? await readFile(file, "utf8") : payload;
  const signature = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  console.log(signature);
}

await main();
