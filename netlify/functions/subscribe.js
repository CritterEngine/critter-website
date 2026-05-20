import { handleMailerLiteSubscribe } from "../../server/mailerLiteSubscribe.js";

export async function handler(event) {
  const bodyText = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  const result = await handleMailerLiteSubscribe({
    method: event.httpMethod,
    bodyText,
    env: process.env,
    fetchImpl: fetch,
  });

  return {
    statusCode: result.status,
    headers: result.headers,
    body: result.body,
  };
}
