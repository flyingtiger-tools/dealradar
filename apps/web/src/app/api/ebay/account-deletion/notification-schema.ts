import { z } from "zod";

/**
 * Schéma eBay Marketplace Account Deletion Notification (ADR 0011).
 * Validé strictement : un topic ou une version de schéma inattendus sont
 * rejetés plutôt qu'acceptés silencieusement — cet endpoint n'a qu'un seul
 * usage, aucune raison de recevoir autre chose.
 */
export const EXPECTED_TOPIC = "MARKETPLACE_ACCOUNT_DELETION";
export const EXPECTED_SCHEMA_VERSION = "1.0";

export const accountDeletionNotificationSchema = z.object({
  metadata: z.object({
    topic: z.literal(EXPECTED_TOPIC),
    schemaVersion: z.literal(EXPECTED_SCHEMA_VERSION),
    deprecated: z.boolean().optional(),
  }),
  notification: z.object({
    notificationId: z.string().min(1),
    eventDate: z.string().min(1),
    publishDate: z.string().min(1).optional(),
    publishAttemptCount: z.number().int().nonnegative().optional(),
    data: z.object({
      username: z.string().min(1).optional(),
      userId: z.string().min(1).optional(),
      eiasToken: z.string().min(1).optional(),
    }),
  }),
});

export type AccountDeletionNotification = z.infer<typeof accountDeletionNotificationSchema>;
