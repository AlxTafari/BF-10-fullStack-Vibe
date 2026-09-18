import { createServiceClient } from "../_shared/supabaseClient.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  const client = createServiceClient();
  const { data, error } = await client
    .from("messages")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
});
