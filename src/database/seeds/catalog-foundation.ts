import dotenv from "dotenv";
import { connectDatabase, disconnectDatabase } from "@config/data-source";
import { seedPhase3CatalogFoundation } from "../migrations/phase-03-catalog";

dotenv.config({ quiet: true });

async function main() {
  await connectDatabase();
  await seedPhase3CatalogFoundation();
  console.log("Phase 3 catalog foundation ready");
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error("Phase 3 catalog foundation seed failed");
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
