// Transactional email via Resend's HTTP API (no SDK dependency). If
// RESEND_API_KEY is unset (local dev), the message is logged to the console
// instead of sent, so invite flows still work end-to-end without a provider.

interface InviteEmail {
  to: string;
  businessName: string;
  inviterName: string | null;
  role: string;
  inviteUrl: string;
}

export async function sendInviteEmail(opts: InviteEmail): Promise<{ ok: boolean; dev?: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Better Books <onboarding@resend.dev>";
  const inviter = opts.inviterName ? `${opts.inviterName} invited you` : "You've been invited";
  const subject = `${inviter} to ${opts.businessName} on Better Books`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 8px">Join ${escapeHtml(opts.businessName)}</h2>
      <p style="color:#555;line-height:1.5">
        ${escapeHtml(inviter)} to collaborate on <b>${escapeHtml(opts.businessName)}</b> in Better Books
        as a <b>${escapeHtml(opts.role)}</b>.
      </p>
      <p style="margin:24px 0">
        <a href="${opts.inviteUrl}" style="background:#18b463;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
          Accept invitation
        </a>
      </p>
      <p style="color:#888;font-size:13px">Or paste this link into your browser:<br>${opts.inviteUrl}</p>
      <p style="color:#aaa;font-size:12px">This invitation expires in 7 days.</p>
    </div>`;

  if (!key) {
    console.log(`[email:dev] Invite to ${opts.to} for "${opts.businessName}" -> ${opts.inviteUrl}`);
    return { ok: true, dev: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: opts.to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Email send failed (${res.status}): ${await res.text()}`);
  }
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}
