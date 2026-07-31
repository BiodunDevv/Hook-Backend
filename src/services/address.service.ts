import { isValidObjectId } from "mongoose";
import { CustomerAddress } from "@models/commerce/commerce.model";
import {
  OperationCity,
  OperationState,
  ServiceZone,
} from "@models/platform/geography.model";
import { nextPublicId } from "@services/public-id.service";
import { HttpError } from "@utils/http";

export type AddressInput = {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  stateId: string;
  cityId: string;
  zoneId: string;
  postalCode?: string;
  coordinates?: { latitude: number; longitude: number };
  isDefault?: boolean;
};

function identity(id: string) {
  return isValidObjectId(id)
    ? { $or: [{ _id: id }, { publicId: id }] }
    : { publicId: id };
}

export class AddressService {
  async list(customerId: string) {
    return CustomerAddress.find({ customerId, status: "active" })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean({ virtuals: true });
  }

  async create(customerId: string, input: AddressInput) {
    const resolved = await this.validateCoverage(input);
    if (input.isDefault)
      await CustomerAddress.updateMany(
        { customerId, status: "active" },
        { $set: { isDefault: false } },
      );
    const count = await CustomerAddress.countDocuments({
      customerId,
      status: "active",
    });
    return CustomerAddress.create({
      publicId: await nextPublicId("address"),
      customerId,
      ...input,
      ...resolved,
      isDefault: input.isDefault || count === 0,
      status: "active",
    });
  }

  async update(customerId: string, id: string, input: Partial<AddressInput>) {
    const address = await CustomerAddress.findOne({
      ...identity(id),
      customerId,
      status: "active",
    });
    if (!address) throw new HttpError(404, "Address not found");
    const merged = { ...address.toObject(), ...input } as AddressInput;
    const resolved = await this.validateCoverage(merged);
    if (input.isDefault)
      await CustomerAddress.updateMany(
        { customerId, _id: { $ne: address.id }, status: "active" },
        { $set: { isDefault: false } },
      );
    Object.assign(address, input, resolved);
    await address.save();
    return address.toJSON();
  }

  async archive(customerId: string, id: string) {
    const address = await CustomerAddress.findOne({
      ...identity(id),
      customerId,
      status: "active",
    });
    if (!address) throw new HttpError(404, "Address not found");
    address.status = "archived";
    address.isDefault = false;
    await address.save();
    if (
      !(await CustomerAddress.exists({
        customerId,
        status: "active",
        isDefault: true,
      }))
    ) {
      await CustomerAddress.findOneAndUpdate(
        { customerId, status: "active" },
        { $set: { isDefault: true } },
        { sort: { createdAt: -1 }, returnDocument: "after" },
      );
    }
    return { id: address.publicId, archived: true };
  }

  async setDefault(customerId: string, id: string) {
    const address = await CustomerAddress.findOne({
      ...identity(id),
      customerId,
      status: "active",
    });
    if (!address) throw new HttpError(404, "Address not found");
    await CustomerAddress.updateMany(
      { customerId, status: "active" },
      { $set: { isDefault: false } },
    );
    address.isDefault = true;
    await address.save();
    return address.toJSON();
  }

  async getOwned(customerId: string, id: string) {
    const address = await CustomerAddress.findOne({
      ...identity(id),
      customerId,
      status: "active",
    }).lean({ virtuals: true });
    if (!address) throw new HttpError(404, "Address not found");
    return address;
  }

  private async validateCoverage(
    input: Pick<AddressInput, "stateId" | "cityId" | "zoneId">,
  ) {
    const state = await OperationState.findOne({
      ...identity(input.stateId),
      status: "active",
    }).lean({ virtuals: true });
    if (!state)
      throw new HttpError(
        409,
        "Selected State is not active",
        undefined,
        "ADDRESS_OUTSIDE_COVERAGE",
      );
    const city = await OperationCity.findOne({
      ...identity(input.cityId),
      stateId: state.id,
      status: "active",
    }).lean({ virtuals: true });
    if (!city)
      throw new HttpError(
        409,
        "Selected city is not available in this State",
        undefined,
        "ADDRESS_OUTSIDE_COVERAGE",
      );
    const zone = await ServiceZone.findOne({
      ...identity(input.zoneId),
      stateId: state.id,
      cityId: city.id,
      status: "active",
      deliveryEligible: true,
    }).lean({ virtuals: true });
    if (!zone)
      throw new HttpError(
        409,
        "This address is outside Hook delivery coverage",
        undefined,
        "ADDRESS_OUTSIDE_COVERAGE",
      );
    return { stateId: state.id, cityId: city.id, zoneId: zone.id };
  }
}
