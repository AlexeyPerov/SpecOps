export function serializeUnknownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      stack: error.stack ?? null,
      cause: error.cause ?? null,
    };
  }

  let jsonValue: string | null = null;
  try {
    jsonValue = JSON.stringify(error);
  } catch {
    jsonValue = null;
  }

  return {
    type: typeof error,
    value: String(error),
    json: jsonValue,
  };
}

export function sanitizePermissionNoise(value: string): string {
  const marker = "Permissions associated with this command:";
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) {
    return value;
  }
  return value.slice(0, markerIndex).trim();
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizePermissionNoise(error.message || error.name || "Unknown command error");
  }
  if (typeof error === "string") {
    return sanitizePermissionNoise(error);
  }
  return "Unknown command error";
}

export function sanitizeErrorDetails(details: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...details };
  if (typeof cleaned.message === "string") {
    cleaned.message = sanitizePermissionNoise(cleaned.message);
  }
  if (typeof cleaned.value === "string") {
    cleaned.value = sanitizePermissionNoise(cleaned.value);
  }
  delete cleaned.json;
  return cleaned;
}
