import { Request, Response } from "express";
import { EmailSettings } from "@models/platform/email-settings.model";
import { recordAudit } from "@services/platform-audit.service";
import { clearEmailSettingsCache } from "@services/email-settings.service";
import { HttpError, sendSuccess } from "@utils/http";
import { isActiveBrevoSender } from "@emails/email.service";

export class AdminEmailSettingsController {
  get = async (_req: Request, res: Response) => {
    const settings = await EmailSettings.findOne({ key: "email" }).lean();
    sendSuccess(res, {
      supportEmail: settings?.supportEmail || "",
      hookOpsEmail: settings?.hookOpsEmail || "",
      brevoFromEmail: settings?.brevoFromEmail || "",
      brevoFromName: settings?.brevoFromName || "",
      appName: settings?.appName || "",
      appUrl: settings?.appUrl || "",
      updatedAt: settings?.updatedAt,
    });
  };

  update = async (req: Request, res: Response) => {
    const { reason, ...fields } = req.body;
    const existing = await EmailSettings.findOne({ key: "email" })
      .select("brevoFromEmail")
      .lean();
    if (fields.brevoFromEmail && fields.brevoFromEmail !== existing?.brevoFromEmail) {
      let senderIsActive: boolean;
      try {
        senderIsActive = await isActiveBrevoSender(fields.brevoFromEmail);
      } catch {
        throw new HttpError(
          503,
          "Brevo sender verification is temporarily unavailable. Please try again.",
          undefined,
          "PROVIDER_NOT_READY",
        );
      }
      if (!senderIsActive) {
        throw new HttpError(
          409,
          "Verify and activate this sender in Brevo before using it for Hook emails.",
          undefined,
          "CONFLICT",
        );
      }
    }
    const updated = await EmailSettings.findOneAndUpdate(
      { key: "email" },
      { $set: { ...fields, updatedBy: req.user!.sub } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean();
    clearEmailSettingsCache();
    await recordAudit(req, {
      action: "email_settings.update",
      entityType: "email_settings",
      after: fields,
      reason,
    });
    sendSuccess(res, {
      supportEmail: updated?.supportEmail || "",
      hookOpsEmail: updated?.hookOpsEmail || "",
      brevoFromEmail: updated?.brevoFromEmail || "",
      brevoFromName: updated?.brevoFromName || "",
      appName: updated?.appName || "",
      appUrl: updated?.appUrl || "",
      updatedAt: updated?.updatedAt,
    });
  };
}
