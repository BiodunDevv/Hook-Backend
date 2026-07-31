import { Router } from "express";
import { z } from "zod";
import { AccountType } from "@lib/constants";
import { AuthController } from "@controllers/auth.controller";
import { requireAccountType, requireAuth } from "@middleware/auth";
import { validateBody } from "@middleware/validate";
import {
  HookPartner,
  RunnerMarketAssignment,
  RunnerProfile,
} from "@models/platform/operations-accounts.model";
import { Market } from "@models/platform/network.model";
import { User } from "@models/users/user.model";
import { asyncHandler, HttpError, sendSuccess } from "@utils/http";
import { loginSchema } from "@validations/common.schemas";
import { RunnerCatalogController } from "@controllers/runner/catalog.controller";
import { runnerSubmissionDraftSchema } from "@validations/catalog.schemas";
import { PartnerCommerceController } from "@controllers/partner-commerce.controller";
import {
  checkoutConfirmSchema,
  checkoutPreviewSchema,
  commerceCartItemSchema,
} from "@validations/commerce.schemas";

export function createRunnerRouter() {
  const router = Router();
  const auth = new AuthController();
  const catalog = new RunnerCatalogController();
  router.post(
    "/auth/login",
    validateBody(loginSchema),
    asyncHandler(auth.runnerLogin),
  );
  router.use(requireAuth, requireAccountType(AccountType.RUNNER));
  router.get(
    "/profile",
    asyncHandler(async (req, res) => {
      const [account, profile] = await Promise.all([
        User.findById(req.user!.sub)
          .select("-password -refreshToken")
          .lean({ virtuals: true }),
        RunnerProfile.findOne({ accountId: req.user!.sub }).lean({
          virtuals: true,
        }),
      ]);
      if (!profile)
        throw new HttpError(
          404,
          "Runner profile not found",
          undefined,
          "NOT_FOUND",
        );
      sendSuccess(res, { account, profile });
    }),
  );
  router.patch(
    "/profile",
    asyncHandler(async (req, res) => {
      const allowed = (({ phone, avatarUrl, preferences }) => ({
        phone,
        avatarUrl,
        preferences,
      }))(req.body);
      const account = await User.findByIdAndUpdate(
        req.user!.sub,
        { $set: allowed },
        { returnDocument: "after" },
      )
        .select("-password -refreshToken")
        .lean({ virtuals: true });
      sendSuccess(res, account);
    }),
  );
  router.get(
    "/markets",
    asyncHandler(async (req, res) => {
      const profile = await RunnerProfile.findOne({
        accountId: req.user!.sub,
      }).lean();
      if (!profile)
        throw new HttpError(
          404,
          "Runner profile not found",
          undefined,
          "NOT_FOUND",
        );
      const assignments = await RunnerMarketAssignment.find({
        runnerId: profile._id.toString(),
        status: "active",
      }).lean({ virtuals: true });
      const markets = await Market.find({
        _id: { $in: assignments.map((item) => item.marketId) },
        status: "active",
      }).lean({ virtuals: true });
      sendSuccess(res, { assignments, markets });
    }),
  );
  router.get("/dashboard", asyncHandler(catalog.dashboard));
  router.get("/product-submissions", asyncHandler(catalog.list));
  router.post(
    "/product-submissions",
    validateBody(runnerSubmissionDraftSchema),
    asyncHandler(catalog.create),
  );
  router.get("/product-submissions/:id", asyncHandler(catalog.detail));
  router.patch(
    "/product-submissions/:id",
    validateBody(runnerSubmissionDraftSchema),
    asyncHandler(catalog.update),
  );
  router.post(
    "/product-submissions/:id/submit",
    validateBody(
      z.object({ version: z.coerce.number().int().positive() }).strict(),
    ),
    asyncHandler(catalog.submit),
  );
  return router;
}

export function createPartnerRouter() {
  const router = Router();
  const auth = new AuthController();
  const commerce = new PartnerCommerceController();
  router.post(
    "/auth/login",
    validateBody(loginSchema),
    asyncHandler(auth.partnerLogin),
  );
  router.use(requireAuth, requireAccountType(AccountType.PARTNER));
  router.get(
    "/profile",
    asyncHandler(async (req, res) => {
      const [account, partner] = await Promise.all([
        User.findById(req.user!.sub)
          .select("-password -refreshToken")
          .lean({ virtuals: true }),
        HookPartner.findOne({ accountId: req.user!.sub }).lean({
          virtuals: true,
        }),
      ]);
      if (!partner)
        throw new HttpError(
          404,
          "Hook Partner profile not found",
          undefined,
          "NOT_FOUND",
        );
      sendSuccess(res, { account, partner });
    }),
  );
  router.patch(
    "/profile",
    asyncHandler(async (req, res) => {
      const allowed = (({ phone, avatarUrl, preferences }) => ({
        phone,
        avatarUrl,
        preferences,
      }))(req.body);
      const account = await User.findByIdAndUpdate(
        req.user!.sub,
        { $set: allowed },
        { returnDocument: "after" },
      )
        .select("-password -refreshToken")
        .lean({ virtuals: true });
      sendSuccess(res, account);
    }),
  );
  router.get(
    "/location",
    asyncHandler(async (req, res) => {
      const partner = await HookPartner.findOne({
        accountId: req.user!.sub,
      }).lean({ virtuals: true });
      if (!partner)
        throw new HttpError(
          404,
          "Hook Partner location not found",
          undefined,
          "NOT_FOUND",
        );
      sendSuccess(res, partner);
    }),
  );
  router.get("/customers/lookup", asyncHandler(commerce.lookupCustomer));
  router.post(
    "/customers",
    validateBody(
      z
        .object({
          firstName: z.string().min(1).max(80),
          lastName: z.string().min(1).max(80),
          email: z.string().email(),
          phone: z.string().min(7).max(30),
          consent: z.literal(true),
          policyVersions: z
            .object({
              TERMS: z.string(),
              PRIVACY: z.string(),
              RETURNS: z.string(),
            })
            .strict(),
        })
        .strict(),
    ),
    asyncHandler(commerce.createCustomer),
  );
  router.get("/customers/:customerId/cart", asyncHandler(commerce.getCart));
  router.post(
    "/customers/:customerId/cart/items",
    validateBody(commerceCartItemSchema),
    asyncHandler(commerce.addCart),
  );
  router.patch(
    "/customers/:customerId/cart/items/:itemId",
    validateBody(
      z.object({ quantity: z.coerce.number().int().min(1).max(99) }).strict(),
    ),
    asyncHandler(commerce.updateCart),
  );
  router.delete(
    "/customers/:customerId/cart/items/:itemId",
    asyncHandler(commerce.removeCart),
  );
  router.post(
    "/customers/:customerId/checkout/states/:stateId/preview",
    validateBody(checkoutPreviewSchema),
    asyncHandler(commerce.preview),
  );
  router.post(
    "/customers/:customerId/checkout/states/:stateId/confirm",
    validateBody(checkoutConfirmSchema),
    asyncHandler(commerce.confirm),
  );
  router.get("/orders", asyncHandler(commerce.orders));
  router.get("/commerce/config", asyncHandler(commerce.commerceConfig));
  router.post(
    "/orders/:orderId/payment-instructions",
    asyncHandler(commerce.paymentInstructions),
  );
  return router;
}
