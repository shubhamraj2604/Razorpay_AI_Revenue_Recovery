import { pgTable, text, integer, boolean, timestamp, real, jsonb, pgEnum } from "drizzle-orm/pg-core";

// ============================================
// ENUMS
// ============================================

export const transactionStatusEnum = pgEnum("transaction_status", [
  "FAILED",
  "COOLDOWN",
  "RECOVERING",
  "RECOVERED",
  "SELF_RESOLVED",
  "ESCALATED",
  "ABANDONED",
]);

export const recoveryStrategyEnum = pgEnum("recovery_strategy", [
  "RETRY",
  "PAYMENT_LINK",
  "HUMAN_REVIEW",
  "NO_ACTION",
  "STOP",
]);

export const recoverabilityEnum = pgEnum("recoverability", [
  "HIGH",
  "MEDIUM",
  "LOW",
  "NONE",
]);

export const recoveryAttemptStatusEnum = pgEnum("recovery_attempt_status", [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
]);

export const failureClassificationEnum = pgEnum("failure_classification", [
  "TEMPORARY_FAILURE",
  "PAYMENT_METHOD_ISSUE",
  "CUSTOMER_ABANDONMENT",
  "HIGH_RISK",
  "UNKNOWN",
]);

// ============================================
// CUSTOMERS TABLE
// ============================================

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// TRANSACTIONS TABLE
// ============================================

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  customerId: text("customer_id")
    .references(() => customers.id)
    .notNull(),
  razorpayPaymentId: text("razorpay_payment_id"),
  razorpayOrderId: text("razorpay_order_id"),
  amount: integer("amount").notNull(), // in paise (₹1 = 100 paise)
  currency: text("currency").default("INR").notNull(),
  status: transactionStatusEnum("status").default("FAILED").notNull(),
  failureReason: text("failure_reason"),
  paymentMethod: text("payment_method"), // UPI, CARD, NET_BANKING, WALLET
  cooldownUntil: timestamp("cooldown_until"),
  customerRetrying: boolean("customer_retrying").default(false).notNull(),
  selfResolved: boolean("self_resolved").default(false).notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  paymentLinkId: text("payment_link_id"),
  paymentLinkUrl: text("payment_link_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================
// RECOVERY ATTEMPTS TABLE
// ============================================

export const recoveryAttempts = pgTable("recovery_attempts", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id")
    .references(() => transactions.id)
    .notNull(),
  strategy: recoveryStrategyEnum("strategy").notNull(),
  aiConfidence: real("ai_confidence"),
  reason: text("reason"),
  status: recoveryAttemptStatusEnum("status").default("PENDING").notNull(),
  amountRecovered: integer("amount_recovered").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// AGENT ACTIONS TABLE
// ============================================

export const agentActions = pgTable("agent_actions", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id")
    .references(() => transactions.id)
    .notNull(),
  action: recoveryStrategyEnum("action").notNull(),
  classification: failureClassificationEnum("classification"),
  recoverability: recoverabilityEnum("recoverability"),
  reason: text("reason"),
  confidence: real("confidence"),
  requiresUserAction: boolean("requires_user_action").default(true),
  policyResult: text("policy_result"), // APPROVED, REJECTED, ESCALATED
  policyReason: text("policy_reason"),
  executionResult: text("execution_result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// AUDIT LOGS TABLE
// ============================================

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id")
    .references(() => transactions.id)
    .notNull(),
  event: text("event").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// WEBHOOK EVENTS TABLE (idempotency)
// ============================================

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventId: text("event_id").unique().notNull(),
  eventType: text("event_type").notNull(),
  processed: boolean("processed").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
