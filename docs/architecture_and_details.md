# AI Revenue Recovery Agent - Comprehensive Architecture & Study Guide

This document is a deep dive into the architecture, design decisions, and code-level details of the AI Revenue Recovery Agent. It is designed to give you end-to-end understanding of the project, preparing you for any questions about how it works under the hood.

---

## 1. High-Level Architecture Overview

At its core, the AI Revenue Recovery Agent is an intelligent intermediary between the payment gateway (Razorpay) and the merchant. It intercepts failed payments, pauses to observe user behavior, analyzes the situation using an LLM (Gemini), and makes a policy-checked decision on how to recover the lost revenue without blindly spamming the user.

### Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Database:** Neon (Serverless PostgreSQL)
- **ORM:** Drizzle ORM
- **AI Model:** Gemini 3.6 Flash (via `@google/generative-ai`)
- **Payments:** Razorpay API
- **Emails:** Resend
- **Background Jobs:** Inngest
- **UI & Charts:** React 19, TailwindCSS, Recharts, Lucide Icons

---

## 2. Database Schema (Drizzle + Neon)

The database (defined in `src/db/schema.ts`) is designed to track transactions, customer history, AI reasoning, and audit trails.

### Key Tables
1. **`transactions`**: The core table. Tracks `amount`, `status` (e.g., `FAILED`, `COOLDOWN`, `RECOVERING`, `RECOVERED`), `failureReason`, and `paymentLinkId`.
2. **`customers`**: Stores customer details (`name`, `email`, `phone`).
3. **`recovery_attempts`**: Records every attempt made to recover a transaction, including the strategy (`RETRY`, `PAYMENT_LINK`, `HUMAN_REVIEW`) and whether it succeeded.
4. **`agent_actions`**: Stores the exact output of the AI model for each transaction (`classification`, `confidence`, `reason`, `recommended_action`), and how the policy engine judged it.
5. **`audit_logs`**: An append-only log tracking every micro-event in the system (e.g., `CUSTOMER_CONTEXT_FETCHED`, `AI_ANALYSIS_COMPLETED`, `POLICY_REJECTED`) for debugging and transparency.
6. **`webhook_events`**: Ensures idempotency. Tracks Razorpay webhook event IDs so duplicate webhooks aren't processed twice.

---

## 3. The 4-Phase Recovery Pipeline

The recovery process is orchestrated primarily in `src/services/recovery-engine.ts`. When a failure is processed (after a cooldown period), it goes through four distinct phases:

### Phase 1: Context Gathering (`customer-context.ts`)
Instead of treating every failure equally, the system fetches historical data about the customer:
- Total payments and successful payments (to calculate a `successRate`).
- Whether they frequently self-retry (`selfRetryRate`).
- If they are actively retrying the *current* payment.
- The time since their last successful payment.

### Phase 2: AI Diagnosis (`ai-agent.ts`)
The context and transaction details are securely fed to **Gemini 3.6 Flash**. 
- **PII Masking:** Before sending data to the LLM, the customer's name is masked (e.g., `A*** [REDACTED]`) to ensure privacy.
- **System Prompt & JSON Output:** The model is strictly instructed to return a JSON object with a specific schema (`AIDecision`). 
- **Classification:** The AI classifies the failure into categories like `TEMPORARY_FAILURE` (e.g., network timeout), `PAYMENT_METHOD_ISSUE` (e.g., insufficient funds), `CUSTOMER_ABANDONMENT`, or `HIGH_RISK`.
- **Recommendation:** It outputs a `confidence` score (0.0 to 1.0) and a `recommended_action` (`RETRY`, `PAYMENT_LINK`, `HUMAN_REVIEW`, `STOP`).

### Phase 3: Policy Engine / Safety Layer (`policy-engine.ts`)
The AI's recommendation is *never* executed blindly. It must pass through the `validatePolicy` function, which runs 7 hardcoded rules:
1. **Customer Self-Retry:** If the customer is actively retrying, abort recovery (Don't spam).
2. **Already Resolved:** If the transaction succeeded in the meantime, abort.
3. **AI Recommendation:** If the AI said `STOP`, respect it and abort.
4. **Amount Limit:** If the transaction is over a certain limit (e.g., ₹10,000), escalate to `HUMAN_REVIEW`.
5. **Confidence Threshold:** If the AI's confidence is below `0.70`, escalate to `HUMAN_REVIEW`.
6. **Attempt Limit:** If we've already tried to recover this transaction 2 times, abort (prevent harassment).
7. **Duplicate Check:** Ensure no other active recovery is pending for this transaction.

*If any rule fails, the system safely stops or escalates. If all pass, it proceeds.*

### Phase 4: Execution (`recovery-engine.ts`)
Based on the approved action, the engine executes:
- **`PAYMENT_LINK`**: Generates a unique Razorpay Payment Link using `razorpay.paymentLink.create`. Crucially, it embeds the original `transaction_id` in the link's `notes` metadata. It then uses **Resend** to email the customer a beautiful HTML email containing the link and the AI's reason for failure.
- **`RETRY`**: (Simulated in the hackathon version) Attempts to auto-retry the payment in the background. If it fails, it gracefully falls back to sending a `PAYMENT_LINK`.
- **`HUMAN_REVIEW`**: Flags the transaction as `ESCALATED` in the database, requiring the merchant to manually approve or reject it via the dashboard.

---

## 4. Closing the Loop (Webhook Architecture)

The system relies on Razorpay Webhooks to operate asynchronously:

1. **`payment.failed`**: When this webhook is received, the system checks for idempotency, logs the failure, and triggers an **Inngest** background job. This job applies a "Cooldown" (e.g., 5-10 minutes) to give the user time to fix the issue themselves. Once the cooldown expires, it triggers the Recovery Engine pipeline.
2. **`payment_link.paid`**: When a customer pays via the AI-generated link, this webhook fires. Because the system embedded the original `transaction_id` into the Razorpay link's metadata during Phase 4, the webhook handler extracts it and updates the original failed transaction's status to `RECOVERED`. *This means zero database polling is required.*

---

## 5. UI and Dashboard

The frontend (Next.js App Router) provides a merchant dashboard to monitor the AI's performance.

- **Data APIs (`src/app/api/dashboard/*`)**: Serve aggregated metrics like Recovery Rate, Revenue Recovered, and status distributions.
- **Simulation/Benchmark (`src/app/api/benchmark/*` & `src/app/api/simulate/*`)**: Allows users/judges to run a 1,000-transaction simulation to see the ROI of the AI versus a traditional rule-based system, or trigger specific scenarios (e.g., High-Value failure, Low Confidence failure) to watch the Policy Engine in action.
- **Recharts**: Used extensively for visualizing the recovery funnel and AI confidence distributions.

---

## 6. Key Talking Points for Q&A

If you are asked questions about the project, here are the strongest angles:

*   **Why AI instead of rules?** Rules treat a ₹100 timeout and a ₹50,000 fraud alert the same. AI understands context. By feeding the AI customer history, it knows *who* it's talking to, allowing for surgical interventions rather than blind spam.
*   **What if the AI goes rogue? (The Safety Argument):** This is solved by the **Policy Engine**. The AI doesn't execute; it *recommends*. The hardcoded Policy Engine has strict threshold limits (amounts, confidence, retry counts) that cannot be bypassed by a hallucinating LLM.
*   **How does it avoid spamming users?** The "Cooldown + Self-Retry" check. Before any action, the system checks if the user has tried again on their own. If they are actively trying, the system stays silent.
*   **How does the loop close?** By passing state (the original `transaction_id`) through the Razorpay Payment Link's `notes` metadata, ensuring the success webhook automatically reconciles with the failed database entry.
*   **PII & Privacy:** Explain the `maskPII` function in `ai-agent.ts` which redacts names before sending payloads to Gemini.

---
*Happy Studying! You've got this.*
