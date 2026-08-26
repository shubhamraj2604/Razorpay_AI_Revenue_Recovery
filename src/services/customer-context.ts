import { db } from "@/db";
import { customers, transactions, recoveryAttempts } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export interface CustomerContext {
  customerId: string;
  name: string;
  email: string;
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  successRate: number;
  selfResolvedCount: number;
  selfRetryRate: number;
  averageOrderValue: number;
  totalRecoveries: number;
  lastPaymentDaysAgo: number | null;
  hasRetriedCurrentPayment: boolean;
}

/**
 * Build rich customer context for AI decision-making.
 * This includes payment history, self-retry patterns, and recovery history.
 */
export async function getCustomerContext(
  customerId: string,
  currentTransactionId?: string
): Promise<CustomerContext | null> {
  // Get customer
  const customer = await db
    .select()
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer.length) return null;

  const c = customer[0];

  // Get all transactions for this customer
  const allTransactions = await db
    .select()
    .from(transactions)
    .where(eq(transactions.customerId, customerId));

  const totalPayments = allTransactions.length;
  const successfulPayments = allTransactions.filter(
    (t) => t.status === "RECOVERED" || t.status === "SELF_RESOLVED"
  ).length;
  const failedPayments = allTransactions.filter(
    (t) => t.status === "FAILED" || t.status === "ABANDONED"
  ).length;
  const selfResolvedCount = allTransactions.filter(
    (t) => t.selfResolved === true
  ).length;

  const successRate = totalPayments > 0 ? successfulPayments / totalPayments : 0;
  const selfRetryRate =
    failedPayments > 0 ? selfResolvedCount / (failedPayments + selfResolvedCount) : 0;

  // Average order value (in paise)
  const totalAmount = allTransactions.reduce((sum, t) => sum + t.amount, 0);
  const averageOrderValue = totalPayments > 0 ? Math.round(totalAmount / totalPayments) : 0;

  // Total successful recoveries
  const recoveries = await db
    .select()
    .from(recoveryAttempts)
    .where(eq(recoveryAttempts.status, "SUCCESS"));

  const customerRecoveries = recoveries.filter((r) =>
    allTransactions.some((t) => t.id === r.transactionId)
  );

  // Last payment
  const sortedTransactions = [...allTransactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const lastPayment = sortedTransactions[0];
  const lastPaymentDaysAgo = lastPayment
    ? Math.floor(
        (Date.now() - new Date(lastPayment.createdAt).getTime()) / (1000 * 60 * 60 * 24)
      )
    : null;

  // Check if customer is retrying the current transaction
  let hasRetriedCurrentPayment = false;
  if (currentTransactionId) {
    const currentTx = allTransactions.find((t) => t.id === currentTransactionId);
    if (currentTx) {
      hasRetriedCurrentPayment = currentTx.customerRetrying;
    }
  }

  return {
    customerId: c.id,
    name: c.name,
    email: c.email,
    totalPayments,
    successfulPayments,
    failedPayments,
    successRate: Math.round(successRate * 1000) / 1000,
    selfResolvedCount,
    selfRetryRate: Math.round(selfRetryRate * 1000) / 1000,
    averageOrderValue,
    totalRecoveries: customerRecoveries.length,
    lastPaymentDaysAgo,
    hasRetriedCurrentPayment,
  };
}
