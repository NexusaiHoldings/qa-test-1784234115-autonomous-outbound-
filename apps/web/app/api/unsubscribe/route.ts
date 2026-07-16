import { type NextRequest, NextResponse } from "next/server";
import { verifyUnsubscribeToken, upsertSuppression } from "@/lib/sdr/suppression";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function renderHtml(title: string, message: string): string {
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1.5rem}
    .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:2.5rem 3rem;max-width:480px;width:100%;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08)}
    h1{font-size:1.375rem;font-weight:600;color:#111827;margin-bottom:0.875rem}
    p{color:#6b7280;font-size:0.9375rem;line-height:1.65}
    strong{color:#374151}
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeTitle}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return new NextResponse(
      renderHtml(
        "Invalid unsubscribe link",
        "This link is missing a required token. Please use the unsubscribe link from the email you received.",
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const verified = verifyUnsubscribeToken(token);
  if (!verified) {
    return new NextResponse(
      renderHtml(
        "Invalid unsubscribe link",
        "This unsubscribe link is invalid or has expired. Please use the link from a recent email.",
      ),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  try {
    await upsertSuppression(verified.org_id, verified.email, "unsubscribed");
  } catch (err) {
    console.error("[unsubscribe] db error:", err);
    return new NextResponse(
      renderHtml(
        "Something went wrong",
        "We could not process your request right now. Please try again later or reply to any email to opt out.",
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const safeEmail = verified.email
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return new NextResponse(
    renderHtml(
      "You&#39;ve been unsubscribed",
      `<strong>${safeEmail}</strong> has been removed from our outreach list. You will not receive any further emails from us. If this was a mistake, please reply to a previous email.`,
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
