import dotenv from "dotenv";
import { connectDatabase, disconnectDatabase } from "@config/data-source";
import { seedPhase2Foundation } from "../migrations/phase-02-foundation";

dotenv.config({ quiet: true });

async function main() {
  await connectDatabase();
  await seedPhase2Foundation();
  console.log("Phase 2 platform foundation ready");
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error("Phase 2 platform seed failed");
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
