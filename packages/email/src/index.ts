import { createTransport } from "nodemailer";
import type { Mail } from "nodemailer";
import { getEnv } from "@ecommerce/config";

/**
 * Dev email goes to Mailpit (SMTP :1025, UI :8025). In production only the
 * SMTP_* env vars change — templates and call sites stay identical.
 */

let transport: Mail | null = null;

function getTransport(): Mail {
  if (!transport) {
    const env = getEnv();
    transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth:
        env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

async function sendMail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  // Throws on failure so queue workers retry (M4). Callers inside a user
  // flow (e.g. better-auth hooks) catch and log instead.
  await getTransport().sendMail({
    from: getEnv().EMAIL_FROM,
    ...options,
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f4f5;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#18181b">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
      <div style="font-size:18px;font-weight:700;margin-bottom:16px">🛍️ Ecommerce</div>
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
      ${bodyHtml}
      ${getEnv().NODE_ENV === "production" ? "" : '<p style="color:#71717a;font-size:12px;margin-top:32px">Sent by your local dev environment — view all mail at http://localhost:8025</p>'}
    </div>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${url}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${label}</a></p>
  <p style="font-size:12px;color:#71717a;word-break:break-all">Or paste this link: ${url}</p>`;
}

export async function sendVerificationEmail(to: string, url: string): Promise<void> {
  await sendMail({
    to,
    subject: "Verify your email",
    html: layout(
      "Verify your email",
      `<p>Welcome! Please confirm your email address to activate your account.</p>${button(url, "Verify email")}`,
    ),
    text: `Verify your email: ${url}`,
  });
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  await sendMail({
    to,
    subject: "Reset your password",
    html: layout(
      "Reset your password",
      `<p>We received a request to reset your password. If this wasn't you, ignore this email.</p>${button(url, "Reset password")}`,
    ),
    text: `Reset your password: ${url}`,
  });
}

export interface OrderEmailItem {
  title: string;
  quantity: number;
  totalFormatted: string;
}

export interface OrderEmailData {
  orderNumber: string;
  items: OrderEmailItem[];
  totalFormatted: string;
  shipAddress: string;
}

function itemsTable(data: OrderEmailData): string {
  const rows = data.items
    .map(
      (i) =>
        `<tr><td style="padding:6px 0">${escapeHtml(i.title)} × ${i.quantity}</td><td style="text-align:right">${escapeHtml(i.totalFormatted)}</td></tr>`,
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
    <tr><td style="padding-top:8px;border-top:1px solid #e4e4e7"><strong>Total (cash on delivery)</strong></td>
    <td style="text-align:right;border-top:1px solid #e4e4e7"><strong>${data.totalFormatted}</strong></td></tr></table>
    <p style="font-size:14px">Deliver to: ${escapeHtml(data.shipAddress)}</p>`;
}

export async function sendOrderPlacedEmail(to: string, data: OrderEmailData): Promise<void> {
  await sendMail({
    to,
    subject: `Order ${data.orderNumber} placed`,
    html: layout(
      `Order ${data.orderNumber} placed`,
      `<p>Thanks for your order! Payment is cash on delivery — have ${data.totalFormatted} ready.</p>${itemsTable(data)}`,
    ),
    text: `Order ${data.orderNumber} placed. Total ${data.totalFormatted} (cash on delivery).`,
  });
}

export async function sendOrderStatusEmail(
  to: string,
  orderNumber: string,
  status: string,
): Promise<void> {
  await sendMail({
    to,
    subject: `Order ${orderNumber} ${status}`,
    html: layout(
      `Order ${orderNumber} is now “${status}”`,
      `<p>Your order status changed to <strong>${escapeHtml(status)}</strong>.</p>`,
    ),
    text: `Order ${orderNumber} status: ${status}`,
  });
}

export async function sendPaymentReceivedEmail(
  to: string,
  orderNumber: string,
  totalFormatted: string,
): Promise<void> {
  await sendMail({
    to,
    subject: `Payment received for ${orderNumber}`,
    html: layout(
      `Payment received for ${orderNumber}`,
      `<p>We've marked your cash payment of <strong>${totalFormatted}</strong> as received. Thank you!</p>`,
    ),
    text: `Payment of ${totalFormatted} received for order ${orderNumber}.`,
  });
}

export async function sendBackInStockEmail(
  to: string,
  productTitle: string,
  productUrl: string
): Promise<void> {
  await sendMail({
    to,
    subject: `Back in stock: ${productTitle}`,
    html: layout(
      "Back in stock",
      `<p><strong>${escapeHtml(productTitle)}</strong> is back in stock.</p>${button(productUrl, "View product")}`,
    ),
    text: `${productTitle} is back in stock: ${productUrl}`,
  })
}

export async function sendOrderCancelledEmail(
  to: string,
  orderNumber: string,
  reason: string | null,
): Promise<void> {
  await sendMail({
    to,
    subject: `Order ${orderNumber} cancelled`,
    html: layout(
      `Order ${orderNumber} cancelled`,
      `<p>Your order was cancelled${reason ? ` — reason: ${escapeHtml(reason)}` : ""}. Any reserved stock has been returned.</p>`,
    ),
    text: `Order ${orderNumber} cancelled${reason ? `: ${reason}` : ""}.`,
  });
}
