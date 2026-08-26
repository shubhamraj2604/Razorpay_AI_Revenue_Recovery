import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { transactions, customers, webhookEvents } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { generateId, getCooldownExpiry } from "@/lib/utils";
import { createAuditLog } from "@/services/recovery-engine";
import { inngest } from "@/inngest/client";

// ============================================
// RAZORPAY WEBHOOK HANDLER
// ============================================

/**
 * Verify Razorpay webhook signature
 */
function verifyWebhookSignature(body: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("x-razorpay-signature");

    // ─── Step 1: Verify signature ───
    if (signature && process.env.RAZORPAY_WEBHOOK_SECRET) {
      const isValid = verifyWebhookSignature(body, signature);
      if (!isValid) {
        console.error("Invalid webhook signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    const event = JSON.parse(body);
    const eventId = event.event_id || event.id || generateId("EVT");
    const eventType = event.event;

    // ─── Step 2: Idempotency check ───
    const existing = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, eventId))
      .limit(1);

    if (existing.length > 0 && existing[0].processed) {
      return NextResponse.json({ status: "already_processed" });
    }

    // Store webhook event
    if (!existing.length) {
      await db.insert(webhookEvents).values({
        id: generateId("WH"),
        eventId,
        eventType: eventType || "unknown",
        processed: false,
      });
    }

    // ─── Step 3: Route event ───
    const payload = event.payload?.payment?.entity;

    switch (eventType) {
      case "payment.failed":
        await handlePaymentFailed(payload, eventId);
        break;

      case "payment.captured":
        await handlePaymentCaptured(payload, eventId);
        break;

      case "payment_link.paid":
        await handlePaymentLinkPaid(event.payload?.payment_link?.entity, eventId);
        break;

      default:
        console.log(`Unhandled webhook event: ${eventType}`);
    }

    // Mark event as processed
    await db
      .update(webhookEvents)
      .set({ processed: true })
      .where(eq(webhookEvents.eventId, eventId));

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle payment.failed — Start cooldown, schedule recovery
 */
async function handlePaymentFailed(
  payment: Record<string, unknown>,
  eventId: string
) {
  if (!payment) return;

  const razorpayPaymentId = payment.id as string;
  const orderId = payment.order_id as string;
  const amount = payment.amount as number;
  const method = payment.method as string;
  const errorCode = (payment.error_code as string) || "unknown";
  const errorDescription = (payment.error_description as string) || "Payment failed";

  // Check if we already have this transaction
  const existingTx = await db
    .select()
    .from(transactions)
    .where(eq(transactions.razorpayPaymentId, razorpayPaymentId))
    .limit(1);

  if (existingTx.length > 0) {
    // Customer is retrying — update retry count
    await db
      .update(transactions)
      .set({
        customerRetrying: true,
        retryCount: existingTx[0].retryCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, existingTx[0].id));

    await createAuditLog(existingTx[0].id, "CUSTOMER_RETRY_DETECTED", {
      retryCount: existingTx[0].retryCount + 1,
    });
    return;
  }

  // Find or create customer (simplified for demo)
  let customerId = "CUST_" + (payment.contact as string || "unknown").replace(/\D/g, "").slice(-6);
  const existingCustomer = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!existingCustomer.length) {
    await db.insert(customers).values({
      id: customerId,
      name: (payment.notes as Record<string, string>)?.customer_name || "Customer",
      email: (payment.email as string) || "unknown@example.com",
      phone: (payment.contact as string) || undefined,
    });
  }

  // Create transaction with cooldown
  const transactionId = generateId("TX");
  const cooldownUntil = getCooldownExpiry();

  await db.insert(transactions).values({
    id: transactionId,
    customerId,
    razorpayPaymentId,
    razorpayOrderId: orderId,
    amount,
    currency: "INR",
    status: "COOLDOWN",
    failureReason: `${errorCode}: ${errorDescription}`,
    paymentMethod: method?.toUpperCase() || "UNKNOWN",
    cooldownUntil,
    customerRetrying: false,
    selfResolved: false,
    retryCount: 0,
  });

  await createAuditLog(transactionId, "PAYMENT_FAILED", {
    razorpayPaymentId,
    amount,
    failureReason: `${errorCode}: ${errorDescription}`,
    paymentMethod: method,
  });

  await createAuditLog(transactionId, "COOLDOWN_STARTED", {
    cooldownUntil: cooldownUntil.toISOString(),
    cooldownMinutes: parseInt(process.env.COOLDOWN_MINUTES || "10"),
  });

  // Trigger Inngest recovery workflow (will wait for cooldown)
  await inngest.send({
    name: "payment/failed",
    data: {
      transactionId,
      cooldownMinutes: parseInt(process.env.COOLDOWN_MINUTES || "10"),
    },
  });
}

/**
 * Handle payment.captured — Check if this resolves a failed payment (self-retry!)
 */
async function handlePaymentCaptured(
  payment: Record<string, unknown>,
  eventId: string
) {
  if (!payment) return;

  const orderId = payment.order_id as string;
  if (!orderId) return;

  // Check if there's a FAILED/COOLDOWN transaction for this order
  const failedTx = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.razorpayOrderId, orderId),
        // We check for non-resolved statuses
      )
    );

  const unresolvedTx = failedTx.find(
    (t) => ["FAILED", "COOLDOWN"].includes(t.status)
  );

  if (!unresolvedTx) return;

  // Customer self-resolved!
  await db
    .update(transactions)
    .set({
      status: "SELF_RESOLVED",
      selfResolved: true,
      customerRetrying: true,
      razorpayPaymentId: payment.id as string,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, unresolvedTx.id));

  await createAuditLog(unresolvedTx.id, "CUSTOMER_SELF_RESOLVED", {
    razorpayPaymentId: payment.id,
    message: "Customer self-resolved payment. No intervention needed.",
  });
}

/**
 * Handle payment_link.paid — Recovery via payment link succeeded
 */
async function handlePaymentLinkPaid(
  paymentLink: Record<string, unknown>,
  eventId: string
) {
  if (!paymentLink) return;

  const notes = paymentLink.notes as Record<string, string>;
  const transactionId = notes?.transaction_id;
  if (!transactionId) return;

  // Trigger Inngest to handle the recovery success
  await inngest.send({
    name: "payment-link/paid",
    data: {
      transactionId,
      paymentId: (paymentLink.payments as Record<string, unknown>[])?.[0]?.payment_id || "unknown",
      amount: paymentLink.amount as number,
    },
  });
}
