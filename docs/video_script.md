# Razorpay Hackathon: 5-Minute Pitch Script

**Objective:** A high-energy, technically flawless 5-minute pitch that proves you understand enterprise architecture, compliance, and mathematically proven ROI.

### General Tips:
- Do not speed-read. Speak clearly.
- Have all tabs open beforehand (Dashboard, Benchmark, IDE/VSCode).
- If you make a mistake, keep your energy up and keep rolling (you can edit it out later).

---

### SCENE 1: The Architecture & The Prototype (0:00 - 0:45)
**Screen Action:** Start with your **Architecture Diagram** open on the screen. Leave it up for about 10-15 seconds while you introduce the project.

**Audio Script:** 
"Hi judges. Payment failures are a massive leak in e-commerce revenue, and traditional software tries to fix this by blindly spamming users with retry emails. 

We built an **Agentic AI Recovery system**. As you can see from our architecture, we use OAuth, Webhooks, and a Google Gemini AI Agent powered by MCP, sandboxed by a strict Policy Engine. 

You can view this full architecture diagram in detail on our GitHub repo, but for now, let's move straight into the live prototype to see it in action."

---

### SCENE 2: Smart Silence & Live Data (0:45 - 1:45)
**Screen Action:** Switch your screen to the **Main Dashboard**. Click the **"Customer Abandons"** button, and then click the **"Customer Self-Retries"** button.

**Audio Script:**
"Our B2B SaaS layer listens to Razorpay `payment.failed` webhooks without disrupting the merchant's existing systems. 

When a failure hits, we extract the entire context directly from Razorpay—why it failed and the transaction details. This rich context is processed by the AI.

*This* is where the magic happens. Notice this transaction right here."

**Screen Action:** Move your mouse to point at the new transaction that just appeared as `SELF_RESOLVED` and hover over it.

**Audio Script:**
"The AI realized the customer is already trying again based on that context. Instead of spamming them, it exercised **Smart Silence**. Restraint is a feature, and it saves customer loyalty.

And if the AI makes a recommendation, it must pass through our deterministic Policy Engine which enforces the merchant's hard limits before executing."

---

### SCENE 3: Payment Links & The Closed Loop (1:45 - 2:30)
**Screen Action:** Point to a transaction that says `PAYMENT_LINK`. Then, open a new tab to show your email inbox featuring the Resend email with the Razorpay link.

**Audio Script:**
"But what happens when the AI decides action *is* needed?

The AI uses MCP tools to autonomously provision a new Razorpay Payment Link. But here is the critical part: it injects the original failed `transaction_id` into the link's metadata notes.

When the customer pays the link via WhatsApp or email, Razorpay sends us a `payment_link.paid` webhook. Because of that metadata, we instantly map the recovered revenue back to the exact failure in our database. A perfectly closed loop."

---

### SCENE 4: Enterprise Compliance (2:30 - 3:30)
**Screen Action:** Switch back to the dashboard and click the **"Human Review"** or **"Activity Feed"** tab on the left sidebar to show the depth of the application. 

**Audio Script:**
"We also built this for enterprise scale. A Razorpay engineer will ask: *'Is this compliant and secure?'* The answer is yes.

Under the hood, we implemented strict PII masking—scrubbing names and phone numbers before data ever touches the LLM. 

We also built cryptographic signature verification and database idempotency into our webhook handlers, ensuring we are immune to replay attacks."

---

### SCENE 5: The Ablation Benchmark (3:30 - 4:45)
**Screen Action:** Switch to the **Benchmark Tab**. Click "Run Benchmark" so it simulates the 1,000 transactions comparing the Baseline vs AI. 

**Audio Script:**
"Now, what is the actual ROI of this AI compared to just writing a dumb lookup script?

We built an **Ablation Test** to prove it. On screen, we are simulating 1,000 transactions. On the left is a traditional hardcoded script acting purely on error codes. On the right is our Gemini AI.

The traditional script spams customers, sending links to people who were already fixing the problem themselves, resulting in massive drop-off.

The AI outperforms it drastically because it understands the nuance of ambiguity. It ties with the lookup table on obvious errors, but wins decisively on the edge cases."

---

### SCENE 6: The Close (4:45 - 5:00)
**Screen Action:** Switch back to the main dashboard tab, highlighting the total "Recovered Revenue" metric at the top.

**Audio Script:**
"This isn't just a hackathon toy. This is a complete business. 

We can take this live on Razorpay OAuth in weeks, not months, charging merchants a small fee purely on the revenue we recover for them. Thank you."
