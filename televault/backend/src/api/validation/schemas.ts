import { z } from "zod";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";
import { ValidationError } from "../../utils/errors";

const FILE_STATUS_VALUES = [
  "queued",
  "processing",
  "paused",
  "failed",
  "completed",
] as const;

const pageNumber = (min: number, max: number, fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") {
      return undefined;
    }
    if (typeof value === "string" || typeof value === "number") {
      return Number(value);
    }
    return value;
  }, z.number().int().min(min).max(max).default(fallback));

export const paginationSchema = z.object({
  limit: pageNumber(1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE),
  offset: pageNumber(0, Number.MAX_SAFE_INTEGER, 0),
});

export const createProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "displayName cannot be empty")
    .max(80, "displayName cannot exceed 80 characters")
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "displayName cannot contain control characters",
    ),
});

export const listFilesQuerySchema = paginationSchema.extend({
  folderId: z.uuid("folderId must be a UUID").optional(),
  status: z.enum(FILE_STATUS_VALUES).optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "search cannot contain control characters",
    )
    .optional(),
});

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, "name cannot be empty").max(255),
  parentId: z.uuid("parentId must be a UUID").nullable().optional(),
});

export const telegramConfigSchema = z.object({
  apiId: z.coerce.number().int().positive("apiId must be a positive integer"),
  apiHash: z.string().trim().min(8, "apiHash must be at least 8 characters").max(64),
});

export const telegramPhoneSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .regex(
      /^\+[1-9]\d{6,14}$/,
      "phoneNumber must be in international E.164 format, for example +15551234567",
    ),
  forceSMS: z.boolean().optional(),
});

export const telegramVerifySchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "code must contain 4 to 8 digits")
      .optional(),
    phoneCode: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, "code must contain 4 to 8 digits")
      .optional(),
  })
  .refine((data) => data.code !== undefined || data.phoneCode !== undefined, {
    message: "The Telegram login code must contain 4 to 8 digits",
    path: ["code"],
  })
  .transform((data) => ({
    code: (data.code ?? data.phoneCode)!,
  }));

export const telegramCodeSchema = telegramVerifySchema;

export const telegramPasswordSchema = z.object({
  password: z
    .string()
    .min(1, "password cannot be empty")
    .max(256, "password cannot exceed 256 characters"),
});

export const listUploadsQuerySchema = paginationSchema.extend({
  status: z.enum(["queued", "processing", "paused", "failed", "completed"]).optional(),
  fileId: z.uuid("fileId must be a UUID").optional(),
});

export const createUploadJsonSchema = z.object({
  filePath: z.string().min(1, "filePath is required"),
  folderId: z.uuid("folderId must be a UUID").nullable().optional(),
  segmentSize: z.number().int().positive().optional(),
  customSegmentSize: z.number().int().positive().optional(),
  originalFilename: z.string().optional(),
  mimeType: z.string().optional(),
});

export const createDownloadSchema = z.object({
  fileId: z.uuid("fileId must be a UUID"),
  targetDirectory: z.string().trim().optional(),
  targetFilename: z.string().trim().optional(),
});

export const listDownloadsQuerySchema = paginationSchema.extend({
  status: z.enum(["queued", "processing", "paused", "failed", "completed"]).optional(),
  fileId: z.uuid("fileId must be a UUID").optional(),
});

export function formatZodIssues(error: z.ZodError): Array<{
  path: string;
  message: string;
  code: string;
}> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code,
  }));
}

export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      "The request is invalid",
      formatZodIssues(result.error),
    );
  }
  return result.data;
}
