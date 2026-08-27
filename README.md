# AI Revenue Recovery Agent

### Recovering Failed Payments with Contextual AI — Not Blind Retries

> Every year, Indian merchants lose crores to failed payments. Most recovery systems blindly retry the card or spam customers with payment links. This project replaces that with an AI agent that understands *why* a payment failed, evaluates *whether* the customer needs a nudge, and decides the *smartest* recovery action — or stays silent when the customer is already fixing it themselves.

---

## The Problem

When a payment fails on Razorpay, merchants face a tough choice:

- **Do nothing** → lose the revenue permanently.
- **Auto-retry blindly** → risk triggering fraud alerts or annoying the customer.
- **Send a generic payment link** → spam the customer who might already be retrying.

There is no intelligence in the current recovery flow. A ₹200 network timeout and a ₹50,000 suspected fraud case are treated identically.

## The Solution

An **AI-powered recovery agent** that sits between Razorpay and the merchant. It intercepts every failed payment, builds context around the failure, and makes a structured decision:

```
┌─────────────────────────────────────────────────────┐
│                  Payment Fails                      │
│                       │                             │
│                       ▼                             │
│              ┌─────────────────┐                    │
│              │  Watch & Wait   │ ← Cooldown period  │
│              │  (Is customer   │   to detect if     │
│              │   retrying?)    │   customer fixes    │
│              └────────┬────────┘   it themselves     │
│                       │                             │
│            ┌──────────┴──────────┐                  │
│            ▼                     ▼                  │
│     Customer retried       No retry detected        │
│     on their own                 │                  │
│            │                     ▼                  │
│            ▼            ┌────────────────┐          │
│       DO NOTHING        │  AI Agent      │          │
│       (Smart silence)   │  (Gemini 3.6)  │          │
│                         └───────┬────────┘          │
│                                 │                   │
│                                 ▼                   │
│                        ┌────────────────┐           │
│                        │ Policy Engine  │           │
│                        │ (Safety Rules) │           │
│                        └───────┬────────┘           │
│                                │                    │
│                    ┌───────────┼───────────┐        │
│                    ▼           ▼           ▼        │
│               Auto-Retry   Send Link   Escalate    │
│               (Gateway     (Email to   (Human      │
│                errors)     customer)    Review)     │
└─────────────────────────────────────────────────────┘
```

---

## How It Works — The 4-Phase Pipeline

### Phase 1: Context Gathering

When a payment fails, the system doesn't act immediately. It first builds a complete picture:

| Data Point | Source | Why It Matters |
|---|---|---|
| Failure reason | Razorpay webhook payload | "Network timeout" vs "Card stolen" require very different responses |
| Transaction amount | Razorpay webhook payload | A ₹500 failure can be auto-recovered; a ₹50,000 failure needs human review |
| Customer payment history | Our database | A loyal customer with 95% success rate is very likely to pay |
| Recent retry attempts | Our database | If the customer already retried 3 times in 5 minutes, don't send another link |
| Self-retry detection | Cooldown monitoring | If the customer is actively fixing it, the smartest action is silence |

### Phase 2: AI Decision (Gemini 3.6 Flash)

The AI receives all this context and returns a **structured JSON decision**, not free-form text:

```json
{
  "classification": "PAYMENT_METHOD_ISSUE",
  "recoverability": "HIGH",
  "confidence": 0.88,
  "recommended_action": "PAYMENT_LINK",
  "requires_user_action": true,
  "reason": "Card was declined due to insufficient funds. Customer has a 90% historical success rate and has not retried. Sending a payment link with alternative payment options is the optimal recovery path."
}
```

**The AI classifies every failure into one of 5 categories:**

| Classification | Example | Typical Action |
|---|---|---|
| `TEMPORARY_FAILURE` | Network timeout, gateway down | Auto-retry the payment |
| `PAYMENT_METHOD_ISSUE` | Card expired, insufficient funds | Send payment link (customer must act) |
| `CUSTOMER_ABANDONMENT` | Customer left checkout | Send a nudge via email |
| `HIGH_RISK` | Suspected fraud, stolen card | Do NOT recover — escalate to human |
| `UNKNOWN` | Unclear failure reason | Conservative → human review |

### Phase 3: Policy Engine (Safety Layer)

The AI recommends. **The Policy Engine decides.**

Even if the AI says "send a payment link", the Policy Engine runs 7 independent safety checks before allowing execution:

| # | Check | Rule | What Happens If Failed |
|---|---|---|---|
| 1 | Customer Self-Retry | Is the customer already retrying? | → Block. Do nothing. |
| 2 | Already Resolved | Has the payment already succeeded? | → Block. No duplicate action. |
| 3 | AI Confidence | Is confidence ≥ 70%? | → Escalate to human review. |
| 4 | Amount Limit | Is amount ≤ ₹10,000? | → Escalate (too risky for auto-action). |
| 5 | High-Risk Block | Did AI flag as HIGH_RISK? | → Block entirely. |
| 6 | Attempt Limit | Have we already tried 2 times? | → Stop. Avoid customer fatigue. |
| 7 | Duplicate Check | Is another recovery already in progress? | → Block. Prevent spam. |

**All 7 checks must pass** for the system to auto-execute. If any single check fails, the transaction is either blocked or escalated to a human merchant for manual review.

### Phase 4: Execution

Based on the combined AI + Policy decision, the system takes one of three actions:

- **Auto-Retry**: The system retries the payment on the backend (for temporary failures like gateway errors).
- **Payment Link + Email**: A Razorpay payment link is created and an email is sent to the customer via Resend, containing the link to complete payment with an alternative method.
- **Human Review**: The transaction appears in the merchant's dashboard with full AI reasoning. The merchant can click **Approve** (which triggers the payment link + email) or **Reject** (which closes the case).

---

## Integration Architecture — How This Becomes a Real Product

This system is designed as a **B2B SaaS layer** that sits on top of Razorpay. Here is the production integration flow:

### Step 1: Merchant Onboarding via OAuth

```
Merchant
   │
   │  Clicks "Connect with Razorpay"
   ▼
Razorpay OAuth Screen
   │
   │  Merchant authorizes your app
   ▼
Your Backend receives OAuth access token
   │
   ▼
Store merchant credentials securely
```

### Step 2: Automatic Webhook Registration

Once authorized, our backend uses the merchant's token to register a webhook on their Razorpay account:

```
POST /v2/accounts/{merchant_id}/webhooks

{
  "url": "https://api.recoveryagent.com/webhooks/razorpay",
  "events": [
    "payment.failed",
    "payment_link.paid"
  ]
}
```

This means:
- The merchant's **existing** webhooks continue working untouched.
- Our system receives a **copy** of only the events we care about.
- We don't process 100,000 successful payments — only the failures.

### Step 3: Multi-Tenant Event Processing

```
              Razorpay
                 │
       ┌─────────┴──────────┐
       ▼                    ▼
Merchant's own           OUR webhook
webhook (unchanged)      (centralized)
                            │
                            ▼
                     Identify merchant
                     from account_id
                            │
                            ▼
                   Load merchant config
                   (AI rules, limits)
                            │
                            ▼
                     Run AI Pipeline
                            │
                 ┌──────────┼──────────┐
                 ▼          ▼          ▼
            Auto-Retry  Send Link   Escalate
                            │
                            ▼
                  Customer pays via link
                            │
                            ▼
                  payment_link.paid webhook
                            │
                            ▼
                  Match via notes.transaction_id
                            │
                            ▼
                  Mark as RECOVERED ✅
```

### How We Track Recovery Links Back to Original Failures

When our system creates a Razorpay payment link, we attach metadata in the `notes` field:

```javascript
razorpay.paymentLink.create({
  amount: 249900,
  notes: {
    transaction_id: "TX_12345",    // Original failed transaction
    recovery_type: "AI_RECOVERY"
  }
});
```

When the customer pays through this link, Razorpay sends a `payment_link.paid` webhook that includes these same notes. Our system reads `notes.transaction_id`, finds `TX_12345` in the database, and marks it as recovered. **Zero polling. Fully event-driven.**

---

## Benchmark Results

The built-in benchmark simulator runs 1,000 synthetic transactions to compare:

| Metric | Baseline (Rule-Based) | AI Agent | Improvement |
|---|---|---|---|
| Recovery Rate | ~3-4% | ~8-9% | ~2.5x higher |
| Revenue Recovered | ~₹1.8L | ~₹4.4L | ~₹2.6L more |
| False Positives | High (blind retries) | Low (context-aware) | Significantly fewer |
| Customer Spam | Frequent | Only when needed | Better UX |

> **Assumptions**: The benchmark uses probability-based simulation. Recovery success rates are modeled based on AI confidence scores and failure classifications. In production, actual recovery rates would depend on real customer behavior.

---

## Tech Stack

| Component | Technology | Purpose |
|---|---|---|
| Framework | Next.js 16 (App Router) | Full-stack React framework |
| AI Engine | Gemini 3.6 Flash | Transaction diagnosis and decision-making |
| Payment Gateway | Razorpay API | Payment links, webhooks, transaction data |
| Database | Neon (Serverless PostgreSQL) | Transaction, customer, and audit storage |
| ORM | Drizzle | Type-safe database queries |
| Email | Resend | Sending recovery payment links to customers |
| Background Jobs | Inngest | Event queue, cooldown scheduling, retries |
| Charts | Recharts | Dashboard visualizations |

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── dashboard/       # Dashboard data API (overview, transactions, activity)
│   │   ├── simulate/        # Simulation engine (5 predefined scenarios)
│   │   ├── review/          # Human review API (approve/reject escalated cases)
│   │   ├── benchmark/       # 1,000-transaction ROI simulator
│   │   ├── transactions/    # Individual transaction detail API
│   │   ├── webhooks/        # Razorpay webhook listener
│   │   └── seed/            # Database seeding
│   └── page.tsx             # Main dashboard UI
├── components/
│   └── charts.tsx           # Recovery funnel, status distribution, AI confidence charts
├── services/
│   ├── ai-agent.ts          # Gemini AI integration and prompt engineering
│   ├── policy-engine.ts     # 7-check safety validation layer
│   ├── recovery-engine.ts   # Orchestrator: context → AI → policy → execute
│   └── customer-context.ts  # Customer history and behavior analysis
├── db/
│   ├── index.ts             # Neon database connection
│   └── schema.ts            # Drizzle schema (transactions, customers, audit logs)
├── inngest/
│   ├── client.ts            # Inngest client configuration
│   └── functions.ts         # Background job definitions
└── lib/
    └── utils.ts             # Shared utilities (ID generation, currency conversion)
```

---

## Running Locally

### Prerequisites
- Node.js v18+
- A [Neon](https://neon.tech) PostgreSQL database
- A [Google AI Studio](https://aistudio.google.com/apikey) API key (for Gemini)
- A [Resend](https://resend.com) API key (for email delivery)
- Razorpay test keys (optional — system falls back to mock links)

### Setup

```bash
# 1. Clone and install
git clone https://github.com/your-username/ai-revenue-recovery.git
cd ai-revenue-recovery
npm install

# 2. Configure environment
cp .env.example .env.local
# Fill in your API keys in .env.local

# 3. Push database schema
npx drizzle-kit push

# 4. Start development server
npm run dev
```

### Environment Variables

```env
# Razorpay (test mode)
RAZORPAY_KEY_ID=rzp_test_xxxxx
RAZORPAY_KEY_SECRET=xxxxx

# Database
DATABASE_URL=postgresql://...

# AI
GEMINI_API_KEY=xxxxx

# Email
RESEND_API_KEY=re_xxxxx
DEMO_EMAIL=your@email.com

# App Settings
COOLDOWN_MINUTES=10
MAX_AUTO_RECOVERY_AMOUNT=10000
MIN_AI_CONFIDENCE=0.70
MAX_RECOVERY_ATTEMPTS=2
```

---

## Demo Scenarios

The dashboard includes 5 simulation buttons to demonstrate different AI behaviors:

| Scenario | What Happens | AI Decision |
|---|---|---|
| **Customer Abandons** | Payment fails due to insufficient funds. Customer doesn't retry. | AI sends payment link + email |
| **Self-Retry** | Payment fails. Customer retries within cooldown. | AI detects retry → does nothing |
| **High-Value** | ₹28,500 bank decline. Amount exceeds auto-recovery limit. | Policy escalates → human review |
| **Low Confidence** | Unknown failure. AI isn't sure what happened. | Low confidence → human review |
| **Gateway Error** | Temporary gateway issue. | AI auto-retries the payment |

---

*Built for the Razorpay AI Hackathon 2025*
