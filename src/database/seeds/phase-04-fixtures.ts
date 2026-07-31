import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connectDatabase, disconnectDatabase } from "@config/data-source";
import {
  AccountStatus,
  AccountType,
  DEFAULT_DELIVERY_FEE_MINOR,
  DEFAULT_POD_LIMIT_MINOR,
  ScopeType,
  UserRole,
} from "@lib/constants";
import {
  CommercePolicyVersion,
  CommerceSettings,
  CustomerAddress,
} from "@models/commerce/commerce.model";
import {
  OperationCity,
  OperationState,
  ServiceZone,
} from "@models/platform/geography.model";
import { User } from "@models/users/user.model";
import { nextPublicId } from "@services/public-id.service";

dotenv.config({ quiet: true });
async function main() {
  await connectDatabase();
  const now = new Date();
  const policies = {
    TERMS: "2026-07",
    PRIVACY: "2026-07",
    RETURNS: "2026-07",
  } as const;
  for (const [type, version] of Object.entries(policies) as Array<
    ["TERMS" | "PRIVACY" | "RETURNS", string]
  >)
    await CommercePolicyVersion.findOneAndUpdate(
      { type, version },
      {
        $set: { status: "active", effectiveAt: now },
        $setOnInsert: {
          publicId: `POL-${type}-${version}`,
          contentUrl: `https://hook.example/policies/${type.toLowerCase()}/${version}`,
        },
      },
      { upsert: true, returnDocument: "after" },
    );
  await CommerceSettings.findOneAndUpdate(
    { key: "commerce" },
    {
      $set: {
        currency: "NGN",
        defaultDeliveryFeeMinor: DEFAULT_DELIVERY_FEE_MINOR,
        podEnabled: true,
        defaultPodLimitMinor: DEFAULT_POD_LIMIT_MINOR,
        previewTtlMinutes: 10,
        activePolicyVersions: policies,
        updatedBy: "phase-04-seed",
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  const state = await OperationState.findOneAndUpdate(
    { code: "LA" },
    {
      $set: {
        deliveryFeeMinor: DEFAULT_DELIVERY_FEE_MINOR,
        podEnabled: true,
        podLimitMinor: DEFAULT_POD_LIMIT_MINOR,
      },
    },
    { returnDocument: "after" },
  );
  if (!state) throw new Error("Phase 4 fixtures require Lagos");
  const city = await OperationCity.findOne({
    stateId: state.id,
    status: "active",
  });
  const zone = city
    ? await ServiceZone.findOneAndUpdate(
        { cityId: city.id, status: "active" },
        {
          $set: {
            deliveryEligible: true,
            deliveryFeeMinor: DEFAULT_DELIVERY_FEE_MINOR,
            podEnabled: true,
            podLimitMinor: DEFAULT_POD_LIMIT_MINOR,
          },
        },
        { returnDocument: "after" },
      )
    : null;
  if (!city || !zone)
    throw new Error("Phase 4 fixtures require an active Lagos city and zone");
  const email = "customer@hook.test";
  const customer = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        firstName: "Ada",
        lastName: "Okafor",
        phone: "+2348012345678",
        accountType: AccountType.CUSTOMER,
        role: UserRole.SHOPPER,
        accountStatus: AccountStatus.ACTIVE,
        scopeType: ScopeType.SELF,
        isActive: true,
        isEmailVerified: true,
        podEligible: true,
        password: await bcrypt.hash("HookCustomer123!", 12),
      },
      $setOnInsert: { publicId: await nextPublicId("customer") },
    },
    { upsert: true, returnDocument: "after" },
  );
  await CustomerAddress.findOneAndUpdate(
    { customerId: customer.id, label: "Home" },
    {
      $set: {
        recipientName: "Ada Okafor",
        phone: customer.phone,
        line1: "12 Admiralty Way",
        cityId: city.id,
        stateId: state.id,
        zoneId: zone.id,
        isDefault: true,
        status: "active",
      },
      $setOnInsert: { publicId: await nextPublicId("address") },
    },
    { upsert: true, returnDocument: "after" },
  );
  console.log(
    "Phase 4 QA foundation ready: policies, commerce settings, delivery coverage, verified customer, and address",
  );
  await disconnectDatabase();
}
main().catch(async (error) => {
  console.error("Phase 4 QA fixture seed failed");
  console.error(error);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
