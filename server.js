import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();

/* -------------------- BASIC MIDDLEWARE -------------------- */
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

/* -------------------- MONGODB CONNECT -------------------- */
mongoose
  .connect(process.env.MONGO_URL, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err.message));

mongoose.connection.on("error", (err) => {
  console.error("❌ Mongo runtime error:", err.message);
});

/* -------------------- SCHEMA -------------------- */
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

// 🔥 indeks – tez o‘qish uchun
OrderSchema.index({ createdAt: -1 });

const Order = mongoose.model("Order", OrderSchema);

/* -------------------- ROUTES -------------------- */

// HEALTH CHECK (Render uyg‘onishi uchun)
app.get("/", (req, res) => {
  res.status(200).send("🚀 Gilam backend ishlayapti");
});

// ORDERS LIST
app.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(200);

    res.json(orders);
  } catch (e) {
    res.status(500).json({ error: "Orders olishda xato" });
  }
});

// CREATE ORDER (tez javob)
app.post("/orders", async (req, res) => {
  try {
    const order = new Order(req.body);

    // 🔥 MUHIM: oldin response, keyin save
    res.status(201).json({ ok: true });

    await order.save();
  } catch (e) {
    console.error("❌ Save error:", e.message);
  }
});

// DELETE
app.delete("/orders/:id", async (req, res) => {
  try {
    const deleted = await Order.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ ok: false });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

// DELIVERED
app.put("/orders/:id/deliver", async (req, res) => {
  try {
    await Order.findByIdAndUpdate(req.params.id, { delivered: true });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

/* --- KEEP ALIVE (ENG MUHIM QISM) -------------------- */
// Render uxlab qolmasligi uchun
setInterval(() => {
  fetch("https://gilam-yuvish-backend.onrender.com")
    .then(() => console.log("🔄 keep-alive ping"))
    .catch(() => {});
}, 5 * 60 * 1000); // har 5 daqiqa

/* -------------------- START -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Backend port:", PORT);
});
