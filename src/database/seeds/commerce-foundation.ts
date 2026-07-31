import dotenv from "dotenv";
import { connectDatabase, disconnectDatabase } from "@config/data-source";
import { seedPhase4CommerceFoundation } from "../migrations/phase-04-commerce";

dotenv.config({ quiet: true });

async function main() {
  await connectDatabase();
  await seedPhase4CommerceFoundation();
  console.log("Phase 4 commerce foundation ready");
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error("Phase 4 commerce foundation seed failed");
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
