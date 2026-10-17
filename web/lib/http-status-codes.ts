/** Common HTTP status codes for job success checks (empty selection = any 2xx on the server). */

export type HttpStatusPreset = { code: number; label: string; hint?: string };

export const HTTP_STATUS_GROUPS: { title: string; codes: HttpStatusPreset[] }[] = [
  {
    title: "Success",
    codes: [
      { code: 200, label: "OK" },
      { code: 201, label: "Created" },
      { code: 202, label: "Accepted" },
      { code: 204, label: "No content" }
    ]
  },
  {
    title: "Redirect",
    codes: [
      { code: 301, label: "Moved permanently" },
      { code: 302, label: "Found" },
      { code: 304, label: "Not modified" }
    ]
  },
  {
    title: "Client error",
    codes: [
      { code: 400, label: "Bad request" },
      { code: 401, label: "Unauthorized" },
      { code: 403, label: "Forbidden" },
      { code: 404, label: "Not found" },
      { code: 409, label: "Conflict" },
      { code: 422, label: "Unprocessable" },
      { code: 429, label: "Too many requests" }
    ]
  },
  {
    title: "Server error",
    codes: [
      { code: 500, label: "Internal error" },
      { code: 502, label: "Bad gateway" },
      { code: 503, label: "Unavailable" },
      { code: 504, label: "Gateway timeout" }
    ]
  }
];

export const ALL_HTTP_STATUS_PRESETS = HTTP_STATUS_GROUPS.flatMap((g) => g.codes);

export function presetLabel(code: number) {
  return ALL_HTTP_STATUS_PRESETS.find((p) => p.code === code)?.label ?? String(code);
}
