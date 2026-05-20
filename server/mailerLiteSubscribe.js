const MAILERLITE_SUBSCRIBERS_URL = "https://connect.mailerlite.com/api/subscribers";
const MAILERLITE_API_VERSION = "2026-05-18";
const MAX_REQUEST_BODY_BYTES = 4096;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_SUBSCRIBER_STATUSES = new Set([
  "active",
  "unsubscribed",
  "unconfirmed",
  "bounced",
  "junk",
]);

const json = (status, data) => ({
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  },
  body: JSON.stringify(data),
});

const readEnv = (env, key) => {
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
};

const parseGroupIds = (env) => {
  const raw = readEnv(env, "MAILERLITE_GROUP_IDS") || readEnv(env, "MAILERLITE_GROUP_ID");
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
};

const parseSubscriberStatus = (env) => {
  const status = readEnv(env, "MAILERLITE_SUBSCRIBER_STATUS");
  if (!status) return "";
  return ALLOWED_SUBSCRIBER_STATUSES.has(status) ? status : "";
};

export function readNodeRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function handleMailerLiteSubscribe({ method, bodyText, env, fetchImpl }) {
  if (method === "OPTIONS") {
    return json(204, {});
  }

  if (method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  if (bodyText.length > MAX_REQUEST_BODY_BYTES) {
    return json(400, { error: "invalid_json" });
  }

  let body;
  try {
    body = JSON.parse(bodyText || "{}");
  } catch {
    return json(400, { error: "invalid_json" });
  }

  if (typeof body.website === "string" && body.website.trim()) {
    return json(200, { ok: true });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return json(400, { error: "invalid_email" });
  }

  const apiKey = readEnv(env, "MAILERLITE_API_KEY");
  if (!apiKey) {
    return json(503, { error: "subscription_unavailable" });
  }

  const groups = parseGroupIds(env);
  const status = parseSubscriberStatus(env);
  const payload = {
    email,
    ...(name ? { fields: { name } } : {}),
    ...(groups.length ? { groups } : {}),
    ...(status ? { status } : {}),
  };

  let response;
  try {
    response = await fetchImpl(MAILERLITE_SUBSCRIBERS_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-version": MAILERLITE_API_VERSION,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json(502, { error: "subscription_failed" });
  }

  if (response.ok) {
    return json(200, { ok: true });
  }

  if (response.status === 422) {
    return json(400, { error: "invalid_email" });
  }

  return json(502, { error: "subscription_failed" });
}
