import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ⚡ middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ⚡ Mongo connect (1 marta)
mongoose
  .connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => {
    console.error("❌ MongoDB error", err);
    process.exit(1);
  });

// ⚡ Schema
const OrderSchema = new mongoose.Schema(
  {
    name: String,
    phone: String,
    address: String,
    items: Array,
    total: Number,
    paid: Number,
    paymentType: String,
    delivered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", OrderSchema);

// 🔹 TEST
app.get("/", (_, res) => {
  res.send("🚀 Gilam backend ishlayapti");
});

// 🔹 GET orders
app.get("/orders", async (_, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(100);

    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: "DB error" });
  }
});

// 🔹 POST order (ENG MUHIM JOY)
app.post("/orders", async (req, res) => {
  try {
    const order = await Order.create(req.body);

    // ⚡ DARHOL javob
    res.status(201).json({
      ok: true,
      order,
    });
  } catch (e) {
    res.status(400).json({ error: "Create error" });
  }
});

// 🔹 DELETE
app.delete("/orders/:id", async (req, res) => {
  const deleted = await Order.findByIdAndDelete(req.params.id);
  if (!deleted) return res.status(404).json({ ok: false });
  res.json({ ok: true });
});

// 🔹 DELIVER
app.put("/orders/:id/deliver", async (req, res) => {
  await Order.findByIdAndUpdate(req.params.id, { delivered: true });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server port:", PORT);
});
