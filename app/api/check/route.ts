import { checkAnswer } from "@/lib/pipeline";

export const maxDuration = 120;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!answer) return Response.json({ error: "Field 'answer' is required" }, { status: 400 });
  if (answer.length > 8000) return Response.json({ error: "Answer too long (max 8000 chars)" }, { status: 413 });

  try {
    return Response.json(await checkAnswer(answer));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
