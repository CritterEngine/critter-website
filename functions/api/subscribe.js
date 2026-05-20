import { handleMailerLiteSubscribe } from "../../server/mailerLiteSubscribe.js";

export async function onRequest(context) {
  const result = await handleMailerLiteSubscribe({
    method: context.request.method,
    bodyText: context.request.method === "POST" ? await context.request.text() : "",
    env: context.env,
    fetchImpl: fetch,
  });

  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
