
export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export function isEmailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean }> {
  if (!isEmailConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      `[email] RESEND_API_KEY/EMAIL_FROM not set — not sending "${message.subject}" to ${message.to}. ` +
        `The action that triggered this email (invite/reset/etc.) still completed and was persisted; ` +
        `only delivery is skipped. Set RESEND_API_KEY and EMAIL_FROM to enable real delivery.`
    );
    return { sent: false };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    // eslint-disable-next-line no-console
    console.error(`[email] Resend API returned ${response.status} sending "${message.subject}" to ${message.to}: ${body}`);
    return { sent: false };
  }

  return { sent: true };
}

export function inviteEmail(params: {
  to: string;
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
}): EmailMessage {
  return {
    to: params.to,
    subject: `${params.inviterName} invited you to join ${params.organizationName} on HireLab`,
    text: `${params.inviterName} invited you to join ${params.organizationName} on HireLab.\n\nAccept the invite: ${params.acceptUrl}\n\nThis link expires in 7 days.`,
    html: `<p>${escapeHtml(params.inviterName)} invited you to join <strong>${escapeHtml(params.organizationName)}</strong> on HireLab.</p><p><a href="${params.acceptUrl}">Accept the invite</a></p><p>This link expires in 7 days.</p>`,
  };
}

export function passwordResetEmail(params: { to: string; resetUrl: string }): EmailMessage {
  return {
    to: params.to,
    subject: "Reset your HireLab password",
    text: `Reset your password: ${params.resetUrl}\n\nThis link expires in 30 minutes. If you didn't request this, you can ignore this email.`,
    html: `<p>Reset your password:</p><p><a href="${params.resetUrl}">${params.resetUrl}</a></p><p>This link expires in 30 minutes. If you didn't request this, you can ignore this email.</p>`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
